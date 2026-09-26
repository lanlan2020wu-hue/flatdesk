import { htmlToText } from "@/lib/email";
import { ApiError } from "../http";
import { ATTACHMENTS_LINKED, date, fieldMap, str, type Adapter, type Ctx, type Msg, type Raw, type Status } from "../types";

// Help Scout Inbox API 2. Auth: OAuth client credentials from a private app
// (Your Profile > My Apps). Lists are HAL with page numbers.

const TOKEN_URL = "https://api.helpscout.net/v2/oauth2/token";
const STATUS: Record<string, Status> = { active: "open", open: "open", pending: "pending", closed: "closed", spam: "closed" };
const MESSAGE_THREADS = new Set(["customer", "message", "reply", "note", "chat", "phone", "forwardparent", "forwardchild", "beaconchat"]);

function pager(path: string, key: string, idOf: (r: Raw) => string = (r) => str(r.id)) {
  return async (ctx: Ctx, cursor: unknown) => {
    const page = (cursor as number | null) ?? 1;
    const { data } = await ctx.get(`${path}${path.includes("?") ? "&" : "?"}page=${page}`);
    const rows: Raw[] = data._embedded?.[key] ?? [];
    return { records: rows.map((raw) => ({ externalId: idOf(raw), raw })), next: (data.page?.totalPages ?? 1) > page ? page + 1 : null };
  };
}

async function mailboxIds(ctx: Ctx): Promise<string[]> {
  const ids: string[] = [];
  for (let page = 1; ; page++) {
    const { data } = await ctx.get(`mailboxes?page=${page}`);
    ids.push(...((data._embedded?.mailboxes ?? []) as Raw[]).map((m) => str(m.id)));
    if ((data.page?.totalPages ?? 1) <= page) return ids;
  }
}

// Walks one per-mailbox list across every mailbox: cursor { mailboxes, i }.
function perMailbox(sub: string, key: string | null, prefix: string) {
  return async (ctx: Ctx, cursor: unknown) => {
    const c = (cursor as { mailboxes: string[]; i: number } | null) ?? { mailboxes: await mailboxIds(ctx), i: 0 };
    if (!c.mailboxes.length) return { records: [], next: null };
    const mbox = c.mailboxes[c.i];
    const { data } = await ctx.get(`mailboxes/${mbox}/${sub}`);
    const rows = ((key ? data._embedded?.[key] : Array.isArray(data) ? data : data._embedded?.["saved-replies"]) ?? []) as Raw[];
    return {
      records: rows.map((raw) => ({ externalId: `${prefix}${raw.id}`, raw: { ...raw, _mailboxId: mbox } })),
      next: c.i + 1 < c.mailboxes.length ? { ...c, i: c.i + 1 } : null,
    };
  };
}

const fullName = (p: Raw | undefined) => [p?.first ?? p?.firstName, p?.last ?? p?.lastName].filter(Boolean).join(" ") || null;

export const helpscout: Adapter = {
  id: "helpscout",
  name: "Help Scout",
  credentialFields: [
    { name: "appId", label: "App ID" },
    { name: "appSecret", label: "App secret", secret: true },
  ],
  help: [
    "In Help Scout, click your avatar, then Your Profile, then My Apps.",
    "Click Create My App. Any name and redirect URL work (for example https://flatdesk.app).",
    "Copy the App ID and App Secret. Use an account that can see every inbox.",
  ],
  account: (creds) => {
    if (!str(creds.appId).trim() || !str(creds.appSecret).trim()) throw new Error("Enter the App ID and App secret.");
    return "Help Scout account";
  },
  async connect(creds, fetchImpl = fetch) {
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "client_credentials", client_id: str(creds.appId).trim(), client_secret: str(creds.appSecret).trim() }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new ApiError(401, "Help Scout didn't accept the App ID and secret.");
    const { access_token } = (await res.json()) as { access_token: string };
    return { base: "https://api.helpscout.net/v2/", headers: { Authorization: `Bearer ${access_token}` } };
  },
  async verify(ctx) {
    const { data } = await ctx.get("users/me");
    if (!data.id) throw new ApiError(401, "Help Scout didn't accept the App ID and secret.");
    ctx.note("Help Scout's API shares workflow names but not their conditions or actions, so workflows are listed for reference only.");
    ctx.note("Help Scout inboxes aren't separate in Flatdesk yet; each ticket keeps its inbox as a field.");
  },
  phases: [
    {
      kind: "agent",
      label: "Users",
      list: pager("users", "users"),
      map: (r) => ({
        kind: "agent",
        label: fullName(r) ?? str(r.email),
        name: fullName(r) ?? str(r.email),
        email: r.email ? str(r.email) : null,
        role: str(r.role || r.type),
        active: true,
        issues: [],
      }),
    },
    { kind: "group", label: "Inboxes", list: pager("mailboxes", "mailboxes"), map: (r) => ({ kind: "group", label: str(r.name), issues: [] }) },
    { kind: "field", label: "Custom fields", list: perMailbox("fields", "fields", ""), map: (r) => ({ kind: "field", label: str(r.name), issues: [] }) },
    { kind: "tag", label: "Tags", list: pager("tags", "tags", (r) => str(r.name)), map: (r) => ({ kind: "tag", label: str(r.name), name: str(r.name), issues: [] }) },
    {
      kind: "macro",
      label: "Saved replies",
      list: perMailbox("saved-replies", null, ""),
      async hydrate(ctx, raw) {
        if (raw.text) return raw;
        const { data } = await ctx.get(`mailboxes/${raw._mailboxId}/saved-replies/${raw.id}`);
        return { ...raw, ...data };
      },
      async map(r, ctx) {
        const body = htmlToText(str(r.text ?? r.preview));
        const mbox = await ctx.lookup("group", str(r._mailboxId));
        const issues: string[] = [];
        if (/\{%.+?%\}/.test(body)) issues.push("Uses placeholders like {%customer.firstName%}, kept as plain text");
        if (!body) issues.push("Has no reply text");
        const name = mbox ? `${r.name} (${mbox.name})` : str(r.name);
        return { kind: "macro", label: name, name, body, addTags: [], setStatus: null, notApplied: [], active: true, issues };
      },
    },
    {
      kind: "rule",
      label: "Workflows",
      list: pager("workflows", "workflows"),
      async map(r, ctx) {
        const mbox = await ctx.lookup("group", str(r.mailboxId));
        return {
          kind: "rule",
          label: str(r.name),
          name: str(r.name),
          ruleKind: `${r.type ?? ""} workflow`.trim(),
          active: r.status === "active",
          summary: [`${r.type === "manual" ? "Manual" : "Automatic"} workflow${mbox ? ` in ${mbox.name}` : ""}`],
          tagAssign: null,
          issues: ["Kept by name only: Help Scout's API doesn't share workflow conditions and actions"],
        };
      },
    },
    {
      kind: "contact",
      label: "Customers",
      list: pager("customers", "customers"),
      map: (r) => {
        const emails = ((r._embedded?.emails ?? []) as Raw[]).map((e) => str(e.value)).filter(Boolean);
        return {
          kind: "contact",
          label: fullName(r) ?? emails[0] ?? `Customer ${r.id}`,
          email: emails[0] ?? (r.email ? str(r.email) : null),
          name: fullName(r),
          fields: fieldMap([
            ["Other emails", emails.slice(1)],
            ["Phone", ((r._embedded?.phones ?? []) as Raw[]).map((p) => str(p.value))],
            ["Company", r.organization],
            ["Job title", r.jobTitle],
            ["Location", r.location],
            ["Background", r.background],
            ["Websites", ((r._embedded?.websites ?? []) as Raw[]).map((w) => str(w.value))],
          ]),
          issues: emails.length > 1 ? ["Has more than one email address; the others are kept as a field"] : [],
        };
      },
    },
    {
      kind: "ticket",
      label: "Conversations",
      list: pager("conversations?status=all&embed=threads&sortField=createdAt&sortOrder=asc", "conversations"),
      async map(r, ctx) {
        const issues: string[] = [];
        const threads = [...((r._embedded?.threads ?? []) as Raw[])].sort((a, b) => date(a.createdAt).getTime() - date(b.createdAt).getTime());
        const messages: Msg[] = [];
        let events = 0;
        for (const t of threads) {
          if (t.state === "draft") continue;
          if (!MESSAGE_THREADS.has(t.type) || !t.body) {
            events++;
            continue;
          }
          const by: Raw = t.createdBy ?? {};
          const isCustomer = by.type === "customer" || t.type === "customer";
          messages.push({
            externalId: str(t.id),
            author: isCustomer ? "customer" : by.type === "user" ? "agent" : "system",
            authorExternalId: by.id ? str(by.id) : null,
            authorName: fullName(by),
            authorEmail: by.email ? str(by.email) : null,
            body: htmlToText(str(t.body)),
            internal: t.type === "note",
            createdAt: date(t.createdAt),
            attachments: ((t._embedded?.attachments ?? []) as Raw[]).map((a) => ({ name: str(a.filename), url: str(a._links?.web?.href ?? a._links?.data?.href) })),
          });
        }
        if (messages.some((m) => m.attachments.length)) issues.push(ATTACHMENTS_LINKED);
        if (events) issues.push("Assignment and state-change events are kept in the import archive, not shown in the thread");

        const mbox = await ctx.lookup("group", str(r.mailboxId));
        const status = STATUS[str(r.status)] ?? "open";
        const fields = fieldMap([
          ["Status in Help Scout", r.status],
          ["Inbox", mbox ? mbox.name : r.mailboxId],
          ["Channel", r.source?.type],
          ["CC", r.cc],
          ["BCC", r.bcc],
          ["Folder", r.folderId],
        ]);
        for (const cf of (r.customFields ?? []) as Raw[]) if (cf.text || cf.value) fields[str(cf.name)] = str(cf.text || cf.value);

        const cust: Raw = r.primaryCustomer ?? {};
        return {
          kind: "ticket",
          label: str(r.subject) || `Conversation ${r.number}`,
          skip: r.status === "spam" ? "Marked as spam in the old help desk, so it wasn't imported" : null,
          number: Number(r.number) || null,
          subject: str(r.subject) || "(no subject)",
          status,
          channel: r.source?.type === "chat" || r.type === "chat" ? "chat" : "email",
          createdAt: date(r.createdAt),
          updatedAt: date(r.userUpdatedAt ?? r.closedAt ?? r.createdAt),
          closedAt: status === "closed" ? date(r.closedAt ?? r.userUpdatedAt) : null,
          requester: { externalId: cust.id ? str(cust.id) : null, email: cust.email ? str(cust.email) : null, name: fullName(cust) },
          assigneeExternalId: r.assignee?.id ? str(r.assignee.id) : null,
          tags: ((r.tags ?? []) as Raw[]).map((t) => str(t.tag ?? t.name)),
          fields,
          messages,
          issues,
        };
      },
    },
  ],
};
