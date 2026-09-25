import { htmlToText } from "@/lib/email";
import { ApiError } from "../http";
import { ATTACHMENTS_LINKED, date, fieldMap, str, type Adapter, type Ctx, type Msg, type Raw, type Status } from "../types";

// Intercom (now Fin) REST API. Auth: an access token from a private app in
// the Developer Hub. Conversations are listed, then each is fetched in full
// for its parts (the list only carries the first message).

const VERSION = "2.14";
const STATUS: Record<string, Status> = { open: "open", snoozed: "pending", closed: "closed" };
// Conversation parts that are messages. Everything else (assignments, snoozes,
// state changes) is kept in the archive and summarised.
const MESSAGE_PARTS = new Set(["comment", "note", "quick_reply", "note_and_reopen", "open", "close"]);

const html = (v: unknown) => (/<[a-z][\s\S]*>/i.test(str(v)) ? htmlToText(str(v)) : str(v));

// Cursor pagination: pages.next.starting_after.
function pager(path: string, key = "data") {
  return async (ctx: Ctx, cursor: unknown) => {
    const sep = path.includes("?") ? "&" : "?";
    const { data } = await ctx.get(cursor ? `${path}${sep}starting_after=${encodeURIComponent(str(cursor))}` : path);
    const rows: Raw[] = data[key] ?? [];
    return { records: rows.map((raw) => ({ externalId: str(raw.id), raw })), next: data.pages?.next?.starting_after ?? null };
  };
}

// Endpoints that return everything at once.
function whole(path: string, key: string, onMissing?: string) {
  return async (ctx: Ctx) => {
    try {
      const { data } = await ctx.get(path);
      return { records: ((data[key] ?? []) as Raw[]).map((raw) => ({ externalId: str(raw.id ?? raw.name), raw })), next: null };
    } catch (e) {
      if (onMissing && e instanceof ApiError && (e.status === 404 || e.status === 400)) {
        ctx.note(onMissing);
        return { records: [], next: null };
      }
      throw e;
    }
  };
}

async function author(ctx: Ctx, a: Raw | undefined) {
  if (!a) return { kind: "system" as const, name: null, email: null, id: null };
  const id = str(a.id);
  const isAgent = a.type === "admin" || a.type === "bot" || a.type === "team";
  const rec = isAgent ? await ctx.lookup("agent", id) : await ctx.lookup("contact", id);
  return {
    kind: a.type === "bot" ? ("system" as const) : isAgent ? ("agent" as const) : ("customer" as const),
    name: str(a.name ?? rec?.name) || null,
    email: str(a.email ?? rec?.email) || null,
    id,
  };
}

export const intercom: Adapter = {
  id: "intercom",
  name: "Intercom (Fin)",
  credentialFields: [{ name: "token", label: "Access token", secret: true }],
  help: [
    "In Intercom, open Settings, then Integrations, then Developer Hub, and create a new app for your workspace.",
    "Under Authentication, copy the access token.",
    "The app needs read permissions for conversations, contacts, admins, tags and teams.",
  ],
  account: (creds) => {
    if (!str(creds.token).trim()) throw new Error("Paste your Intercom access token.");
    return "Intercom workspace";
  },
  async connect(creds) {
    return {
      base: "https://api.intercom.io/",
      headers: { Authorization: `Bearer ${str(creds.token).trim()}`, "Intercom-Version": VERSION },
    };
  },
  async verify(ctx) {
    const { data } = await ctx.get("me");
    if (!data.id) throw new ApiError(401, "Intercom didn't accept the access token.");
    ctx.note(
      "Intercom's API doesn't share workflows or assignment rules, so none were imported. Recreate the tag assignments you need under Macros and rules.",
    );
  },
  phases: [
    {
      kind: "agent",
      label: "Teammates",
      list: whole("admins", "admins"),
      map: (r) => ({
        kind: "agent",
        label: str(r.name),
        name: str(r.name) || str(r.email),
        email: r.email ? str(r.email) : null,
        role: r.type === "team" ? "team" : "agent",
        active: true,
        issues: r.type === "team" ? ["A team inbox, not a person; kept for reference"] : [],
      }),
    },
    { kind: "group", label: "Teams", list: whole("teams", "teams"), map: (r) => ({ kind: "group", label: str(r.name), issues: [] }) },
    {
      kind: "field",
      label: "Conversation attributes",
      list: whole("data_attributes?model=conversation", "data"),
      map: (r) => ({ kind: "field", label: str(r.label ?? r.name), issues: [] }),
    },
    { kind: "tag", label: "Tags", list: whole("tags", "data"), map: (r) => ({ kind: "tag", label: str(r.name), name: str(r.name), issues: [] }) },
    {
      kind: "macro",
      label: "Macros",
      list: async (ctx, cursor) => {
        try {
          return await pager("macros?per_page=50")(ctx, cursor);
        } catch (e) {
          if (e instanceof ApiError && (e.status === 404 || e.status === 400)) {
            ctx.note("This Intercom workspace's API didn't return macros, so none were imported. Copy them over under Macros and rules.");
            return { records: [], next: null };
          }
          throw e;
        }
      },
      map: (r) => {
        const body = html(r.body_text ?? r.body);
        const notApplied: string[] = [];
        for (const a of (r.actions ?? []) as Raw[]) notApplied.push(str(a.type ?? a.name ?? JSON.stringify(a)).replace(/_/g, " "));
        const issues: string[] = [];
        if (notApplied.length) issues.push("Some actions have no Flatdesk equivalent; they're listed on the macro");
        if (/\{\{.+?\}\}/.test(body)) issues.push("Uses placeholders like {{first_name}}, kept as plain text");
        if (!body) issues.push("Has no reply text");
        return { kind: "macro", label: str(r.name), name: str(r.name), body, addTags: [], setStatus: null, notApplied, active: true, issues };
      },
    },
    {
      kind: "company",
      label: "Companies",
      list: async (ctx, cursor) => {
        // Companies use page numbers.
        const page = (cursor as number | null) ?? 1;
        const { data } = await ctx.get(`companies?per_page=50&page=${page}`);
        const rows: Raw[] = data.data ?? [];
        return { records: rows.map((raw) => ({ externalId: str(raw.id), raw })), next: data.pages?.total_pages > page ? page + 1 : null };
      },
      map: (r) => ({ kind: "company", label: str(r.name), issues: [] }),
    },
    {
      kind: "contact",
      label: "Contacts",
      list: pager("contacts?per_page=150"),
      map: (r) => ({
        kind: "contact",
        label: str(r.name) || str(r.email) || `Contact ${r.id}`,
        email: r.email ? str(r.email) : null,
        name: r.name ? str(r.name) : null,
        fields: fieldMap([
          ["Role", r.role],
          ["Phone", r.phone],
          ["External ID", r.external_id],
          ["Location", [r.location?.city, r.location?.country].filter(Boolean).join(", ")],
          ["Companies", (r.companies?.data ?? []).map((c: Raw) => c.name ?? c.id)],
          ["Signed up", r.signed_up_at ? date(r.signed_up_at).toISOString() : null],
          ["Last seen", r.last_seen_at ? date(r.last_seen_at).toISOString() : null],
          ...Object.entries(r.custom_attributes ?? {}),
        ]),
        issues: [],
      }),
    },
    {
      kind: "ticket",
      label: "Conversations",
      list: pager("conversations?per_page=50", "conversations"),
      async hydrate(ctx, raw) {
        const { data } = await ctx.get(`conversations/${raw.id}?display_as=plaintext`);
        return data;
      },
      async map(r, ctx) {
        const issues: string[] = [];
        const messages: Msg[] = [];
        const src: Raw = r.source ?? {};
        const first = await author(ctx, src.author);
        const attach = (list: Raw[] | undefined) => (list ?? []).map((a) => ({ name: str(a.name), url: str(a.url) }));

        messages.push({
          externalId: `source:${r.id}`,
          author: first.kind,
          authorExternalId: first.id,
          authorName: first.name,
          authorEmail: first.email,
          body: html(src.body),
          internal: false,
          createdAt: date(r.created_at),
          attachments: attach(src.attachments),
        });
        let events = 0;
        for (const p of (r.conversation_parts?.conversation_parts ?? []) as Raw[]) {
          if (!MESSAGE_PARTS.has(p.part_type) || !p.body) {
            events++;
            continue;
          }
          const a = await author(ctx, p.author);
          messages.push({
            externalId: str(p.id),
            author: a.kind,
            authorExternalId: a.id,
            authorName: a.name,
            authorEmail: a.email,
            body: html(p.body),
            internal: p.part_type === "note" || p.part_type === "note_and_reopen",
            createdAt: date(p.created_at),
            attachments: attach(p.attachments),
          });
        }
        if (messages.some((m) => m.attachments.length)) issues.push(ATTACHMENTS_LINKED);
        if (events) issues.push("Assignment and state-change events are kept in the import archive, not shown in the thread");
        const total = r.conversation_parts?.total_count ?? 0;
        if (total > (r.conversation_parts?.conversation_parts?.length ?? 0)) issues.push("Intercom returned only the latest 500 parts of this conversation");

        const contactRef: Raw | undefined = r.contacts?.contacts?.[0];
        const contact = contactRef ? await ctx.lookup("contact", str(contactRef.id)) : null;
        const status = STATUS[str(r.state)] ?? "open";
        const tags = ((r.tags?.tags ?? []) as Raw[]).map((t) => str(t.name));
        const team = r.team_assignee_id ? await ctx.lookup("group", str(r.team_assignee_id)) : null;
        const fields = fieldMap([
          ["State in Intercom", r.state],
          ["Priority", r.priority],
          ["Team", team ? team.name : r.team_assignee_id],
          ["Channel", src.type],
          ["Delivered as", src.delivered_as],
          ["Rating", r.conversation_rating?.rating],
          ["Rating remark", r.conversation_rating?.remark],
          ["Title", r.title],
          ...Object.entries(r.custom_attributes ?? {}),
        ]);
        const subject = str(r.title) || str(src.subject) || html(src.body).split("\n")[0].slice(0, 120) || "(no subject)";

        return {
          kind: "ticket",
          label: subject,
          skip: null,
          number: null, // Intercom ids are long; Flatdesk numbers them
          subject: htmlToText(subject),
          status,
          channel: src.type === "email" ? "email" : "chat",
          createdAt: date(r.created_at),
          updatedAt: date(r.updated_at),
          closedAt: status === "closed" ? date(r.statistics?.last_close_at ?? r.updated_at) : null,
          requester: {
            externalId: contactRef ? str(contactRef.id) : first.id,
            email: str(contact?.email ?? (first.kind === "customer" ? first.email : "")) || null,
            name: str(contact?.name ?? (first.kind === "customer" ? first.name : "")) || null,
          },
          assigneeExternalId: r.admin_assignee_id ? str(r.admin_assignee_id) : null,
          tags,
          fields,
          messages,
          issues,
        };
      },
    },
  ],
};
