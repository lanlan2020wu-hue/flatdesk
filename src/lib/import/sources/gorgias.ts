import { htmlToText } from "@/lib/email";
import { ApiError, CredentialError } from "../http";
import { date, fieldMap, str, type Adapter, type Ctx, type Mapped, type Msg, type Raw, type Status } from "../types";

// Gorgias REST API. Auth: the account email and an API key from Settings, REST
// API, sent as Basic auth. Lists are cursor-paged: ?limit=100&cursor=<next_cursor>,
// answered as { data: [...], meta: { next_cursor } }. Written from Gorgias's
// published API reference and tested against recorded-shape fixtures.

const LIMIT = 100;
const CHANNEL_NAME: Record<string, string> = { email: "Email", chat: "Chat", "help-center": "Help center", "contact_form": "Contact form", phone: "Phone", sms: "SMS", facebook: "Facebook", instagram: "Instagram", "api": "API" };

function pages(path: string, idOf: (r: Raw) => string = (r) => str(r.id)) {
  return async (ctx: Ctx, cursor: unknown) => {
    const c = cursor as string | null;
    const { data } = await ctx.get(`${path}${path.includes("?") ? "&" : "?"}limit=${LIMIT}${c ? `&cursor=${encodeURIComponent(c)}` : ""}`);
    const rows = (Array.isArray(data.data) ? data.data : []) as Raw[];
    return { records: rows.map((raw) => ({ externalId: idOf(raw), raw })), next: data.meta?.next_cursor ? str(data.meta.next_cursor) : null };
  };
}

function domain(creds: Record<string, string>) {
  const raw = str(creds.domain).trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].replace(/\.gorgias\.com$/, "");
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(raw)) throw new CredentialError("Enter your Gorgias domain, like acme for acme.gorgias.com.");
  return raw;
}

const bodyOf = (m: Raw) => str(m.stripped_text) || str(m.body_text) || (m.body_html ? htmlToText(str(m.body_html)) : "");
const files = (list: Raw[] | undefined) =>
  (list ?? []).map((a) => ({ name: str(a.name) || "attachment", url: str(a.url), size: Number(a.size) || null, contentType: a.content_type ? str(a.content_type) : null }));

export const gorgias: Adapter = {
  id: "gorgias",
  name: "Gorgias",
  credentialFields: [
    { name: "domain", label: "Gorgias domain", placeholder: "acme (from acme.gorgias.com)" },
    { name: "email", label: "Account email", placeholder: "you@yourstore.com" },
    { name: "apiKey", label: "API key", secret: true },
  ],
  help: [
    "In Gorgias, open Settings, then REST API.",
    "Copy the API key. Use an admin's email and key so every ticket, macro and customer is visible.",
  ],
  account: (creds) => {
    if (!/^[^\s@]+@[^\s@]+$/.test(str(creds.email).trim())) throw new CredentialError("Enter the email address you sign in to Gorgias with.");
    return `${domain(creds)}.gorgias.com`;
  },
  async connect(creds) {
    if (!str(creds.apiKey).trim()) throw new CredentialError("Enter your Gorgias API key.");
    return {
      base: `https://${domain(creds)}.gorgias.com/api/`,
      headers: { Authorization: `Basic ${Buffer.from(`${str(creds.email).trim()}:${str(creds.apiKey).trim()}`).toString("base64")}` },
    };
  },
  async verify(ctx) {
    const { data } = await ctx.get("account");
    if (!data.domain && !data.id) throw new ApiError(401, "Gorgias didn't accept the email and API key.");
    ctx.note("Gorgias rules are kept for reference only; their conditions are code that can't be run in Flatdesk. Rebuild the ones you still need as triggers.");
    ctx.note("Gorgias teams aren't in Flatdesk yet; each ticket keeps its team as a field.");
    return { key: `${domain(ctx.creds)}.gorgias.com` };
  },
  phases: [
    {
      kind: "agent",
      label: "Users",
      list: pages("users"),
      map: (r) => ({
        kind: "agent",
        label: str(r.name) || str(r.email),
        name: str(r.name) || str(r.email),
        email: r.email ? str(r.email) : null,
        role: str(r.role?.name ?? r.role ?? "agent"),
        active: r.active !== false,
        issues: [],
      }),
    },
    { kind: "group", label: "Teams", list: pages("teams"), map: (r) => ({ kind: "group", label: str(r.name), issues: [] }) },
    { kind: "tag", label: "Tags", list: pages("tags", (r) => str(r.name)), map: (r) => ({ kind: "tag", label: str(r.name), name: str(r.name), issues: [] }) },
    {
      kind: "macro",
      label: "Macros",
      list: pages("macros"),
      map: (r): Mapped => {
        let body = "";
        const addTags: string[] = [];
        let setStatus: Status | null = null;
        const notApplied: string[] = [];
        for (const a of (r.actions ?? []) as Raw[]) {
          const args = (a.arguments ?? {}) as Raw;
          if (a.name === "setResponseText") body = body || str(args.body_text) || htmlToText(str(args.body_html));
          else if (a.name === "addTags") addTags.push(...str(args.tags).split(",").map((t) => t.trim()).filter(Boolean));
          else if (a.name === "setStatus" && (args.status === "open" || args.status === "closed")) setStatus = args.status;
          else notApplied.push(str(a.title) || str(a.name));
        }
        const issues: string[] = [];
        if (/\{\{.+?\}\}/.test(body)) issues.push("Uses placeholders like {{ticket.customer.firstname}}, kept as plain text");
        if (notApplied.length) issues.push("Some actions have no Flatdesk equivalent; they're listed on the macro");
        if (!body) issues.push("Has no reply text");
        return { kind: "macro", label: str(r.name), name: str(r.name), body, addTags, setStatus, notApplied, active: !r.archived_datetime, issues };
      },
    },
    {
      kind: "rule",
      label: "Rules",
      list: pages("rules"),
      map: (r) => ({
        kind: "rule",
        label: str(r.name),
        name: str(r.name),
        ruleKind: "rule",
        active: !r.deactivated_datetime,
        summary: str(r.code).split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 30),
        tagAssign: null,
        issues: ["Kept for reference, not running: Gorgias rules are written as code; rebuild it as a trigger"],
      }),
    },
    {
      kind: "contact",
      label: "Customers",
      list: pages("customers"),
      map: (r) => ({
        kind: "contact",
        label: str(r.name) || str(r.email),
        email: r.email ? str(r.email) : null,
        name: r.name ? str(r.name) : null,
        fields: fieldMap([
          ["Language", r.language],
          ["Time zone", r.timezone],
          ["Note", r.note],
          ["Phone", ((r.channels ?? []) as Raw[]).filter((c) => c.type === "phone").map((c) => c.address)],
          ["Other emails", ((r.channels ?? []) as Raw[]).filter((c) => c.type === "email" && c.address !== r.email).map((c) => c.address)],
          ...Object.entries((r.data ?? {}) as Raw).filter(([, v]) => typeof v !== "object").map(([k, v]) => [k, v] as [string, unknown]),
        ]),
        issues: [],
      }),
    },
    {
      kind: "ticket",
      label: "Tickets",
      list: pages("tickets?order_by=created_datetime:asc"),
      async hydrate(ctx, raw) {
        const messages: Raw[] = [];
        let cursor: string | null = null;
        do {
          const { data } = await ctx.get(`messages?ticket_id=${raw.id}&order_by=created_datetime:asc&limit=${LIMIT}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
          messages.push(...((Array.isArray(data.data) ? data.data : []) as Raw[]));
          cursor = data.meta?.next_cursor ? str(data.meta.next_cursor) : null;
        } while (cursor);
        return { ...raw, _messages: messages };
      },
      async map(r, ctx) {
        const issues: string[] = [];
        const status: Status = r.status === "closed" ? "closed" : "open";
        const channel = str(r.channel);
        const fields = fieldMap([
          ["Priority", r.priority],
          ["Channel", CHANNEL_NAME[channel] ?? channel],
          ["Team", r.assignee_team?.name],
          ["Language", r.language],
          ["Snoozed until", r.snooze_datetime],
          ...Object.entries((r.custom_fields ?? {}) as Raw).map(([k, v]) => [k, (v as Raw)?.value ?? v] as [string, unknown]),
        ]);
        if (channel && !["email", "chat", "help-center", "contact_form", "api"].includes(channel)) issues.push("Came in from social media, SMS or phone; imported as a conversation by email");
        const customer: Raw = r.customer ?? {};
        const messages: Msg[] = [];
        for (const m of (r._messages ?? []) as Raw[]) {
          if (m.deleted_datetime) continue;
          const fromAgent = Boolean(m.from_agent);
          const sender: Raw = m.sender ?? {};
          const internal = m.public === false;
          messages.push({
            externalId: str(m.id),
            author: fromAgent ? "agent" : "customer",
            authorExternalId: sender.id ? str(sender.id) : null,
            authorName: sender.name ? str(sender.name) : null,
            authorEmail: sender.email ? str(sender.email) : m.source?.from?.address ? str(m.source.from.address) : null,
            body: bodyOf(m),
            internal,
            createdAt: date(m.created_datetime ?? m.sent_datetime),
            attachments: files(m.attachments),
          });
        }
        if (!messages.length) messages.push({ externalId: `excerpt:${r.id}`, author: "customer", authorExternalId: customer.id ? str(customer.id) : null, authorName: customer.name ? str(customer.name) : null, authorEmail: customer.email ? str(customer.email) : null, body: str(r.excerpt), internal: false, createdAt: date(r.created_datetime), attachments: [] });
        void ctx;
        return {
          kind: "ticket",
          label: str(r.subject) || `Ticket ${r.id}`,
          skip: r.spam ? "Marked as spam in the old help desk, so it wasn't imported" : r.trashed_datetime ? "In the trash in the old help desk, so it wasn't imported" : null,
          number: Number(r.id) || null,
          subject: str(r.subject) || "(no subject)",
          status,
          channel: channel === "chat" ? "chat" : "email",
          createdAt: date(r.created_datetime),
          updatedAt: date(r.updated_datetime),
          closedAt: status === "closed" ? date(r.closed_datetime ?? r.updated_datetime) : null,
          requester: { externalId: customer.id ? str(customer.id) : null, email: customer.email ? str(customer.email) : null, name: customer.name ? str(customer.name) : null },
          assigneeExternalId: r.assignee_user?.id ? str(r.assignee_user.id) : null,
          tags: ((r.tags ?? []) as Raw[]).map((t) => str(t.name)).filter(Boolean),
          fields,
          messages,
          issues,
        };
      },
    },
  ],
};
