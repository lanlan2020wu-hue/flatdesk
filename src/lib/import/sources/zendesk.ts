import { htmlToText } from "@/lib/email";
import { ApiError } from "../http";
import { ATTACHMENTS_LINKED, date, fieldMap, str, type Adapter, type Ctx, type Mapped, type Msg, type Raw, type Status } from "../types";

// Zendesk Support API v2. Auth: agent email + API token (Admin Center >
// Apps and integrations > APIs > Zendesk API). Tickets come from the
// incremental export, which unlike /tickets also includes archived tickets.

const STATUS: Record<string, Status> = { new: "open", open: "open", pending: "pending", hold: "pending", solved: "closed", closed: "closed" };
const CHAT_CHANNELS = new Set(["chat", "native_messaging", "messaging", "whatsapp", "facebook", "instagram_dm", "line", "wechat", "sms", "twitter_dm"]);

// Follows either cursor (`links.next` + `meta.has_more`) or offset (`next_page`) pagination.
const nextOf = (d: Raw): string | null => (d.meta ? (d.meta.has_more ? d.links?.next ?? null : null) : d.next_page ?? null);

function pager(path: string, key: string, idOf: (r: Raw) => string = (r) => str(r.id)) {
  return async (ctx: Ctx, cursor: unknown) => {
    const { data } = await ctx.get((cursor as string | null) ?? path);
    const rows: Raw[] = data[key] ?? [];
    return { records: rows.map((raw) => ({ externalId: idOf(raw), raw })), next: nextOf(data) };
  };
}

function subdomain(creds: Record<string, string>) {
  const raw = str(creds.subdomain).trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].replace(/\.zendesk\.com$/, "");
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(raw)) throw new Error("Enter your Zendesk subdomain, like acme for acme.zendesk.com.");
  return raw;
}

async function name(ctx: Ctx, kind: "group" | "agent" | "company", id: unknown) {
  if (id === null || id === undefined) return null;
  const r = await ctx.lookup(kind, str(id));
  return r ? str(r.name) : `#${id}`;
}

function macroBody(v: unknown): string {
  // comment_value is either the text or ["channel:all", "text"].
  const text = Array.isArray(v) ? str(v[v.length - 1]) : str(v);
  return /<[a-z][\s\S]*>/i.test(text) ? htmlToText(text) : text;
}

async function describeAction(ctx: Ctx, a: Raw): Promise<string> {
  const v = Array.isArray(a.value) ? a.value.join(" ") : str(a.value);
  switch (a.field) {
    case "priority":
      return `Set priority to ${v}`;
    case "type":
      return `Set type to ${v}`;
    case "group_id":
      return `Assign to group ${(await name(ctx, "group", a.value)) ?? v}`;
    case "assignee_id":
      return v === "current_user" ? "Assign to the agent using the macro" : `Assign to ${(await name(ctx, "agent", a.value)) ?? v}`;
    case "remove_tags":
      return `Remove tags: ${v}`;
    case "subject":
      return `Set subject to "${v}"`;
    case "comment_mode_is_public":
      return v === "false" ? "Post the reply as an internal note" : "Post the reply publicly";
    default: {
      const m = /^custom_fields_(\d+)$/.exec(a.field);
      if (m) {
        const f = await ctx.lookup("field", m[1]);
        return `Set ${f ? str(f.title) : `field ${m[1]}`} to ${v}`;
      }
      return `${a.field}: ${v}`;
    }
  }
}

function describeCondition(c: Raw) {
  return `${c.field} ${str(c.operator).replace(/_/g, " ") || "is"} ${Array.isArray(c.value) ? c.value.join(", ") : str(c.value)}`.trim();
}

async function mapRule(ctx: Ctx, raw: Raw, ruleKind: string): Promise<Mapped> {
  const all: Raw[] = raw.conditions?.all ?? [];
  const any: Raw[] = raw.conditions?.any ?? [];
  const actions: Raw[] = raw.actions ?? [];
  const summary = [
    ...(all.length ? [`When all of: ${all.map(describeCondition).join("; ")}`] : []),
    ...(any.length ? [`When any of: ${any.map(describeCondition).join("; ")}`] : []),
    ...(await Promise.all(actions.map(async (a) => `Then: ${await describeAction(ctx, a)}`))),
  ];

  // "When tagged X, assign to agent Y" is the one shape Flatdesk runs today.
  // Conditions on update type or status are how Zendesk scopes triggers to new tickets; they're implied.
  const tagConds = all.filter((c) => c.field === "current_tags" && c.operator === "includes" && str(c.value).trim().split(/\s+/).length === 1);
  const scoping = all.filter((c) => c.field === "update_type" || (c.field === "status" && c.value === "new"));
  const assign = actions.filter((a) => a.field === "assignee_id" && /^\d+$/.test(str(a.value)));
  const tagAssign =
    ruleKind === "trigger" && tagConds.length === 1 && tagConds.length + scoping.length === all.length && any.length === 0 && assign.length === 1 && actions.length === 1
      ? { tag: str(tagConds[0].value).trim(), agentExternalId: str(assign[0].value) }
      : null;

  return {
    kind: "rule",
    label: str(raw.title),
    name: str(raw.title),
    ruleKind,
    active: raw.active !== false,
    summary,
    tagAssign,
    issues: tagAssign ? [] : ["Kept for reference, not running: Flatdesk rules can only assign by tag"],
  };
}

export const zendesk: Adapter = {
  id: "zendesk",
  name: "Zendesk",
  credentialFields: [
    { name: "subdomain", label: "Zendesk subdomain", placeholder: "acme (from acme.zendesk.com)" },
    { name: "email", label: "Admin email", placeholder: "you@company.com" },
    { name: "token", label: "API token", secret: true },
  ],
  help: [
    "In Zendesk, open Admin Center, then Apps and integrations, then Zendesk API.",
    "Turn on Token access and click Add API token. Copy it; Zendesk shows it once.",
    "Use the email of an admin, so macros, triggers and every ticket are visible.",
  ],
  account: (creds) => `${subdomain(creds)}.zendesk.com`,
  async connect(creds) {
    const email = str(creds.email).trim();
    if (!email || !creds.token) throw new Error("Enter the admin email and API token.");
    return {
      base: `https://${subdomain(creds)}.zendesk.com/api/v2/`,
      headers: { Authorization: `Basic ${Buffer.from(`${email}/token:${str(creds.token).trim()}`).toString("base64")}` },
    };
  },
  async verify(ctx) {
    const { data } = await ctx.get("users/me.json");
    if (!data.user?.id) throw new ApiError(401, "Zendesk didn't accept the email and token.");
    if (data.user.role !== "admin") ctx.note("The token belongs to an agent, not an admin, so some macros and triggers may be missing.");
  },
  phases: [
    {
      kind: "agent",
      label: "Agents",
      list: pager("users.json?role[]=agent&role[]=admin&page[size]=100", "users"),
      map: (r) => ({
        kind: "agent",
        label: str(r.name),
        name: str(r.name) || str(r.email),
        email: r.email ? str(r.email) : null,
        role: str(r.role),
        active: r.active !== false && !r.suspended,
        issues: [],
      }),
    },
    { kind: "group", label: "Groups", list: pager("groups.json?page[size]=100", "groups"), map: (r) => ({ kind: "group", label: str(r.name), issues: [] }) },
    { kind: "field", label: "Ticket fields", list: pager("ticket_fields.json?page[size]=100", "ticket_fields"), map: (r) => ({ kind: "field", label: str(r.title), issues: [] }) },
    {
      kind: "tag",
      label: "Tags",
      list: pager("tags.json?page[size]=100", "tags", (r) => str(r.name)),
      map: (r) => ({ kind: "tag", label: str(r.name), name: str(r.name), issues: [] }),
    },
    {
      kind: "macro",
      label: "Macros",
      list: pager("macros.json?page[size]=100", "macros"),
      async map(r, ctx) {
        const actions: Raw[] = r.actions ?? [];
        let body = "";
        const addTags: string[] = [];
        let setStatus: Status | null = null;
        const notApplied: string[] = [];
        for (const a of actions) {
          if (a.field === "comment_value" || a.field === "comment_value_html") body ||= macroBody(a.value);
          else if (a.field === "current_tags") addTags.push(...str(a.value).split(/\s+/));
          else if (a.field === "set_tags") {
            addTags.push(...str(a.value).split(/\s+/));
            notApplied.push("Replace all tags (Flatdesk adds these tags instead)");
          } else if (a.field === "status" && STATUS[str(a.value)]) {
            setStatus = STATUS[str(a.value)];
            if (a.value === "hold") notApplied.push("Set status to On-hold (Flatdesk sets Pending)");
          } else notApplied.push(await describeAction(ctx, a));
        }
        const issues: string[] = [];
        if (notApplied.length) issues.push("Some actions have no Flatdesk equivalent; they're listed on the macro");
        if (!body) issues.push("Has no reply text");
        if (r.active === false) issues.push("Inactive in the old help desk, so it wasn't added to your macros");
        return { kind: "macro", label: str(r.title), name: str(r.title), body, addTags, setStatus, notApplied, active: r.active !== false, issues };
      },
    },
    {
      kind: "rule",
      label: "Triggers and automations",
      async list(ctx, cursor) {
        const c = (cursor as { which: "triggers" | "automations"; url: string | null } | null) ?? { which: "triggers", url: null };
        const { data } = await ctx.get(c.url ?? `${c.which}.json?page[size]=100`);
        const rows: Raw[] = data[c.which] ?? [];
        const url = nextOf(data);
        const next = url ? { which: c.which, url } : c.which === "triggers" ? { which: "automations", url: null } : null;
        const kind = c.which === "triggers" ? "trigger" : "automation";
        return { records: rows.map((raw) => ({ externalId: `${kind}:${raw.id}`, raw: { ...raw, _kind: kind } })), next };
      },
      map: (r, ctx) => mapRule(ctx, r, r._kind),
    },
    { kind: "company", label: "Organizations", list: pager("organizations.json?page[size]=100", "organizations"), map: (r) => ({ kind: "company", label: str(r.name), issues: [] }) },
    {
      kind: "contact",
      label: "Contacts",
      list: pager("users.json?role=end-user&page[size]=100", "users"),
      async map(r, ctx) {
        return {
          kind: "contact",
          label: str(r.name) || str(r.email),
          email: r.email ? str(r.email) : null,
          name: r.name ? str(r.name) : null,
          fields: fieldMap([
            ["Phone", r.phone],
            ["Organization", r.organization_id ? await name(ctx, "company", r.organization_id) : null],
            ["Time zone", r.time_zone],
            ["Locale", r.locale],
            ["Tags", r.tags],
            ["Notes", r.notes],
            ["Details", r.details],
            ["External ID", r.external_id],
            ...Object.entries(r.user_fields ?? {}),
          ]),
          issues: [],
        };
      },
    },
    {
      kind: "ticket",
      label: "Tickets",
      async list(ctx, cursor) {
        const { data } = await ctx.get((cursor as string | null) ?? "incremental/tickets/cursor.json?start_time=0");
        const rows: Raw[] = data.tickets ?? [];
        return { records: rows.map((raw) => ({ externalId: str(raw.id), raw })), next: data.end_of_stream ? null : data.after_url ?? null };
      },
      async hydrate(ctx, raw) {
        if (raw.status === "deleted") return raw;
        const comments: Raw[] = [];
        const users: Raw[] = [];
        let url: string | null = `tickets/${raw.id}/comments.json?page[size]=100&include=users`;
        while (url) {
          const { data }: { data: Raw } = await ctx.get(url);
          comments.push(...(data.comments ?? []));
          users.push(...(data.users ?? []));
          url = nextOf(data);
        }
        return { ...raw, _comments: comments, _users: users };
      },
      async map(r, ctx) {
        const issues: string[] = [];
        const users = new Map<string, Raw>((r._users ?? []).map((u: Raw) => [str(u.id), u]));
        const person = async (id: unknown) => users.get(str(id)) ?? (await ctx.lookup("contact", str(id))) ?? (await ctx.lookup("agent", str(id)));
        const requester = await person(r.requester_id);

        const fields: Record<string, string> = fieldMap([
          ["Status in Zendesk", r.status],
          ["Priority", r.priority],
          ["Type", r.type],
          ["Group", r.group_id ? await name(ctx, "group", r.group_id) : null],
          ["Organization", r.organization_id ? await name(ctx, "company", r.organization_id) : null],
          ["Channel", r.via?.channel],
          ["Due", r.due_at],
          ["Satisfaction", r.satisfaction_rating?.score && r.satisfaction_rating.score !== "unoffered" ? r.satisfaction_rating.score : null],
          ["Brand", r.brand_id],
          ["CCs", r.collaborator_ids?.length ? r.collaborator_ids.length : null],
        ]);
        for (const cf of (r.custom_fields ?? []) as Raw[]) {
          if (cf.value === null || cf.value === "" || cf.value === false) continue;
          const def = await ctx.lookup("field", str(cf.id));
          const opts: Raw[] = def?.custom_field_options ?? [];
          const values = (Array.isArray(cf.value) ? cf.value : [cf.value]).map((v: unknown) => opts.find((o) => o.value === v)?.name ?? str(v));
          fields[def ? str(def.title) : `Field ${cf.id}`] = values.join(", ");
        }

        const comments: Raw[] = r._comments ?? [];
        const messages: Msg[] = [];
        for (const c of comments) {
          const author = await person(c.author_id);
          const isCustomer = author ? (author.role ?? "end-user") === "end-user" : str(c.author_id) === str(r.requester_id);
          const attachments = ((c.attachments ?? []) as Raw[]).map((a) => ({ name: str(a.file_name), url: str(a.content_url) }));
          if (attachments.length) issues.push(ATTACHMENTS_LINKED);
          messages.push({
            externalId: str(c.id),
            author: c.author_id === -1 ? "system" : isCustomer ? "customer" : "agent",
            authorExternalId: str(c.author_id),
            authorName: author ? str(author.name) : null,
            authorEmail: author?.email ? str(author.email) : null,
            body: str(c.plain_body ?? c.body) || (c.html_body ? htmlToText(c.html_body) : ""),
            internal: c.public === false,
            createdAt: date(c.created_at),
            attachments,
          });
        }
        if (!messages.length && r.description) {
          messages.push({
            externalId: `description:${r.id}`,
            author: "customer",
            authorExternalId: str(r.requester_id),
            authorName: requester ? str(requester.name) : null,
            authorEmail: requester?.email ? str(requester.email) : null,
            body: str(r.description),
            internal: false,
            createdAt: date(r.created_at),
            attachments: [],
          });
        }

        const status = STATUS[str(r.status)] ?? "open";
        return {
          kind: "ticket",
          label: str(r.subject) || `Ticket ${r.id}`,
          skip: r.status === "deleted" ? "Deleted in the old help desk, so it wasn't imported" : null,
          number: Number(r.id) || null,
          subject: str(r.subject) || str(r.description).split("\n")[0].slice(0, 120) || "(no subject)",
          status,
          channel: CHAT_CHANNELS.has(str(r.via?.channel)) ? "chat" : "email",
          createdAt: date(r.created_at),
          updatedAt: date(r.updated_at),
          closedAt: status === "closed" ? date(r.updated_at) : null,
          requester: { externalId: str(r.requester_id) || null, email: requester?.email ? str(requester.email) : null, name: requester ? str(requester.name) : null },
          assigneeExternalId: r.assignee_id ? str(r.assignee_id) : null,
          tags: r.tags ?? [],
          fields,
          messages,
          issues: [...new Set(issues)],
        };
      },
    },
  ],
};
