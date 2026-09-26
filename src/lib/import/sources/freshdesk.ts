import { htmlToText } from "@/lib/email";
import { ApiError } from "../http";
import { ATTACHMENTS_LINKED, date, fieldMap, str, type Adapter, type Ctx, type Mapped, type Msg, type Raw, type Status } from "../types";

// Freshdesk API v2. Auth: the API key from Profile settings, sent as the
// Basic auth user. Lists use page numbers; the ticket list stops at page 300,
// so tickets are walked by updated_at in windows.

const PER_PAGE = 100;
const MAX_PAGE = 300;
const STATUS: Record<number, Status> = { 2: "open", 3: "pending", 4: "closed", 5: "closed" };
const STATUS_NAME: Record<number, string> = { 2: "Open", 3: "Pending", 4: "Resolved", 5: "Closed" };
const PRIORITY: Record<number, string> = { 1: "Low", 2: "Medium", 3: "High", 4: "Urgent" };
const SOURCE: Record<number, string> = { 1: "Email", 2: "Portal", 3: "Phone", 5: "Twitter", 6: "Facebook", 7: "Chat", 9: "Feedback widget", 10: "Outbound email" };
const RULE_TYPES = [
  { id: 1, kind: "ticket creation rule" },
  { id: 3, kind: "ticket update rule" },
  { id: 4, kind: "time-based rule" },
];

function pages(path: string, idOf: (r: Raw) => string = (r) => str(r.id)) {
  return async (ctx: Ctx, cursor: unknown) => {
    const page = (cursor as number | null) ?? 1;
    const { data } = await ctx.get(`${path}${path.includes("?") ? "&" : "?"}per_page=${PER_PAGE}&page=${page}`);
    const rows = (Array.isArray(data) ? data : []) as Raw[];
    return { records: rows.map((raw) => ({ externalId: idOf(raw), raw })), next: rows.length === PER_PAGE ? page + 1 : null };
  };
}

function domain(creds: Record<string, string>) {
  const raw = str(creds.domain).trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].replace(/\.freshdesk\.com$/, "");
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(raw)) throw new Error("Enter your Freshdesk domain, like acme for acme.freshdesk.com.");
  return raw;
}

const text = (plain: unknown, html: unknown) => str(plain) || (html ? htmlToText(str(html)) : "");

async function agentName(ctx: Ctx, id: unknown) {
  const a = id ? await ctx.lookup("agent", str(id)) : null;
  return a ? str(a.contact?.name) : id ? `#${id}` : null;
}

async function describe(ctx: Ctx, a: Raw) {
  const v = Array.isArray(a.value) ? a.value.join(", ") : str(a.value);
  switch (a.field_name ?? a.name) {
    case "priority":
      return `Set priority to ${PRIORITY[Number(a.value)] ?? v}`;
    case "status":
      return `Set status to ${STATUS_NAME[Number(a.value)] ?? v}`;
    case "responder_id":
      return `Assign to ${await agentName(ctx, a.value)}`;
    case "group_id": {
      const g = await ctx.lookup("group", v);
      return `Assign to group ${g ? g.name : v}`;
    }
    case "add_tag":
    case "tag_names":
      return `Add tags: ${v}`;
    case "ticket_type":
      return `Set type to ${v}`;
    case "add_note":
      return `Add a private note: ${htmlToText(str(a.note_body ?? a.value)).slice(0, 200)}`;
    case "send_email_to_requester":
    case "send_email_to_group":
    case "send_email_to_agent":
      return `Send an email (${str(a.field_name ?? a.name).replace(/_/g, " ")})`;
    default:
      return `${str(a.field_name ?? a.name).replace(/_/g, " ")}: ${v}`;
  }
}

async function mapRule(ctx: Ctx, r: Raw): Promise<Mapped> {
  const blocks: Raw[] = r.conditions ?? [];
  const actions: Raw[] = r.actions ?? [];
  const summary: string[] = [];
  for (const b of blocks) {
    const props = ((b.properties ?? []) as Raw[]).map((p) => `${p.field_name} ${str(p.operator).replace(/_/g, " ")} ${Array.isArray(p.value) ? p.value.join(", ") : str(p.value)}`);
    if (props.length) summary.push(`When ${b.match_type === "any" ? "any" : "all"} of: ${props.join("; ")}`);
  }
  for (const a of actions) summary.push(`Then: ${await describe(ctx, a)}`);

  const props: Raw[] = blocks.flatMap((b) => b.properties ?? []);
  const tagProp = props.length === 1 && props[0].field_name === "tag_names" && ["in", "is", "contains"].includes(str(props[0].operator)) ? props[0] : null;
  const tagValues = tagProp ? (Array.isArray(tagProp.value) ? tagProp.value : [tagProp.value]) : [];
  const assign = actions.length === 1 && actions[0].field_name === "responder_id" ? actions[0] : null;
  const tagAssign = r._type === 1 && tagValues.length === 1 && assign ? { tag: str(tagValues[0]), agentExternalId: str(assign.value) } : null;

  return {
    kind: "rule",
    label: str(r.name),
    name: str(r.name),
    ruleKind: RULE_TYPES.find((t) => t.id === r._type)?.kind ?? "automation",
    active: r.active !== false,
    summary,
    tagAssign,
    issues: tagAssign ? [] : ["Kept for reference, not running: Flatdesk rules can only assign by tag"],
  };
}

export const freshdesk: Adapter = {
  id: "freshdesk",
  name: "Freshdesk",
  credentialFields: [
    { name: "domain", label: "Freshdesk domain", placeholder: "acme (from acme.freshdesk.com)" },
    { name: "apiKey", label: "API key", secret: true },
  ],
  help: [
    "In Freshdesk, click your profile picture, then Profile settings.",
    "Copy the API key shown on the right. Use an admin's key so every ticket, rule and canned response is visible.",
  ],
  account: (creds) => `${domain(creds)}.freshdesk.com`,
  async connect(creds) {
    if (!str(creds.apiKey).trim()) throw new Error("Enter your Freshdesk API key.");
    return {
      base: `https://${domain(creds)}.freshdesk.com/api/v2/`,
      headers: { Authorization: `Basic ${Buffer.from(`${str(creds.apiKey).trim()}:X`).toString("base64")}` },
    };
  },
  async verify(ctx) {
    const { data } = await ctx.get("agents/me");
    if (!data.id) throw new ApiError(401, "Freshdesk didn't accept the API key.");
    ctx.note("Freshdesk's API doesn't list spam or deleted tickets, so those weren't imported.");
    ctx.note("Freshdesk groups aren't in Flatdesk yet; each ticket keeps its group as a field.");
  },
  phases: [
    {
      kind: "agent",
      label: "Agents",
      list: pages("agents"),
      map: (r) => ({
        kind: "agent",
        label: str(r.contact?.name),
        name: str(r.contact?.name) || str(r.contact?.email),
        email: r.contact?.email ? str(r.contact.email) : null,
        role: r.type ? str(r.type) : "agent",
        active: r.contact?.active !== false,
        issues: [],
      }),
    },
    { kind: "group", label: "Groups", list: pages("groups"), map: (r) => ({ kind: "group", label: str(r.name), issues: [] }) },
    {
      kind: "field",
      label: "Ticket fields",
      // Tickets carry custom fields by name (cf_order_number), so fields are stored by name.
      list: async (ctx) => {
        const { data } = await ctx.get("ticket_fields");
        return { records: ((data as unknown as Raw[]) ?? []).map((raw) => ({ externalId: str(raw.name), raw })), next: null };
      },
      map: (r) => ({ kind: "field", label: str(r.label), issues: [] }),
    },
    {
      kind: "macro",
      label: "Canned responses and scenarios",
      async list(ctx, cursor) {
        type C = { stage: "folders" | "responses" | "scenarios"; folders: string[]; i: number; page: number };
        const c = (cursor as C | null) ?? { stage: "folders", folders: [], i: 0, page: 1 };
        if (c.stage === "folders") {
          const { data } = await ctx.get("canned_response_folders");
          const folders = ((Array.isArray(data) ? data : []) as Raw[]).map((f) => str(f.id));
          return { records: [], next: folders.length ? { stage: "responses", folders, i: 0, page: 1 } : { stage: "scenarios", folders, i: 0, page: 1 } };
        }
        if (c.stage === "responses") {
          const { data } = await ctx.get(`canned_response_folders/${c.folders[c.i]}/responses?per_page=${PER_PAGE}&page=${c.page}`);
          const rows = (Array.isArray(data) ? data : []) as Raw[];
          const next =
            rows.length === PER_PAGE
              ? { ...c, page: c.page + 1 }
              : c.i + 1 < c.folders.length
                ? { ...c, i: c.i + 1, page: 1 }
                : { ...c, stage: "scenarios", page: 1 };
          return { records: rows.map((raw) => ({ externalId: `canned:${raw.id}`, raw: { ...raw, _type: "canned" } })), next };
        }
        const { data } = await ctx.get(`scenario_automations?per_page=${PER_PAGE}&page=${c.page}`);
        const rows = (Array.isArray(data) ? data : []) as Raw[];
        return {
          records: rows.map((raw) => ({ externalId: `scenario:${raw.id}`, raw: { ...raw, _type: "scenario" } })),
          next: rows.length === PER_PAGE ? { ...c, page: c.page + 1 } : null,
        };
      },
      async map(r, ctx) {
        if (r._type === "canned") {
          const body = text(r.content, r.content_html);
          const issues: string[] = [];
          if (/\{\{.+?\}\}/.test(body)) issues.push("Uses placeholders like {{ticket.requester.name}}, kept as plain text");
          if (r.attachments?.length) issues.push(ATTACHMENTS_LINKED);
          return { kind: "macro", label: str(r.title), name: str(r.title), body, addTags: [], setStatus: null, notApplied: [], active: true, issues };
        }
        // Scenario automations are action bundles: Flatdesk keeps tags and status and lists the rest.
        const addTags: string[] = [];
        let setStatus: Status | null = null;
        const notApplied: string[] = [];
        let body = "";
        for (const a of (r.actions ?? []) as Raw[]) {
          const n = a.name ?? a.field_name;
          if (n === "add_tag") addTags.push(...(Array.isArray(a.value) ? a.value : [a.value]).map(str));
          else if (n === "status" && STATUS[Number(a.value)]) setStatus = STATUS[Number(a.value)];
          else if (n === "add_note" && !body) {
            body = htmlToText(str(a.note_body ?? a.value));
            notApplied.push("Adds this text as a private note (Flatdesk inserts it as a reply you can switch to a note)");
          } else notApplied.push(await describe(ctx, a));
        }
        const issues: string[] = [];
        if (notApplied.length) issues.push("Some actions have no Flatdesk equivalent; they're listed on the macro");
        if (!body) issues.push("Has no reply text");
        return { kind: "macro", label: str(r.name), name: str(r.name), body, addTags, setStatus, notApplied, active: true, issues };
      },
    },
    {
      kind: "rule",
      label: "Automation rules",
      async list(ctx, cursor) {
        const c = (cursor as { i: number; page: number } | null) ?? { i: 0, page: 1 };
        const type = RULE_TYPES[c.i];
        const { data } = await ctx.get(`automations/${type.id}/rules?per_page=${PER_PAGE}&page=${c.page}`);
        const rows = (Array.isArray(data) ? data : []) as Raw[];
        const next = rows.length === PER_PAGE ? { i: c.i, page: c.page + 1 } : c.i + 1 < RULE_TYPES.length ? { i: c.i + 1, page: 1 } : null;
        return { records: rows.map((raw) => ({ externalId: `${type.id}:${raw.id}`, raw: { ...raw, _type: type.id } })), next };
      },
      map: (r, ctx) => mapRule(ctx, r),
    },
    { kind: "company", label: "Companies", list: pages("companies"), map: (r) => ({ kind: "company", label: str(r.name), issues: [] }) },
    {
      kind: "contact",
      label: "Contacts",
      list: pages("contacts"),
      async map(r, ctx) {
        const company = r.company_id ? await ctx.lookup("company", str(r.company_id)) : null;
        return {
          kind: "contact",
          label: str(r.name) || str(r.email),
          email: r.email ? str(r.email) : null,
          name: r.name ? str(r.name) : null,
          fields: fieldMap([
            ["Phone", r.phone],
            ["Mobile", r.mobile],
            ["Company", company ? company.name : r.company_id],
            ["Job title", r.job_title],
            ["Other emails", r.other_emails],
            ["Language", r.language],
            ["Time zone", r.time_zone],
            ["Tags", r.tags],
            ["Description", r.description],
            ["Twitter", r.twitter_id],
            ["Unique external ID", r.unique_external_id],
            ...Object.entries(r.custom_fields ?? {}),
          ]),
          issues: r.other_emails?.length ? ["Has more than one email address; the others are kept as a field"] : [],
        };
      },
    },
    {
      kind: "ticket",
      label: "Tickets",
      async list(ctx, cursor) {
        const c = (cursor as { since: string; page: number } | null) ?? { since: "1970-01-01T00:00:00Z", page: 1 };
        const { data } = await ctx.get(
          `tickets?per_page=${PER_PAGE}&page=${c.page}&updated_since=${encodeURIComponent(c.since)}&order_by=updated_at&order_type=asc&include=description,requester`,
        );
        const rows = (Array.isArray(data) ? data : []) as Raw[];
        let next: unknown = null;
        if (rows.length === PER_PAGE) {
          // Past page 300 Freshdesk refuses; restart from the last updated_at (re-seen tickets are skipped).
          next = c.page < MAX_PAGE ? { ...c, page: c.page + 1 } : { since: str(rows[rows.length - 1].updated_at), page: 1 };
        }
        return { records: rows.map((raw) => ({ externalId: str(raw.id), raw })), next };
      },
      async hydrate(ctx, raw) {
        const conversations: Raw[] = [];
        for (let page = 1; ; page++) {
          const { data } = await ctx.get(`tickets/${raw.id}/conversations?per_page=${PER_PAGE}&page=${page}`);
          const rows = (Array.isArray(data) ? data : []) as Raw[];
          conversations.push(...rows);
          if (rows.length < PER_PAGE) break;
        }
        return { ...raw, _conversations: conversations };
      },
      async map(r, ctx) {
        const issues: string[] = [];
        const requester: Raw | null = r.requester ?? (await ctx.lookup("contact", str(r.requester_id)));
        const group = r.group_id ? await ctx.lookup("group", str(r.group_id)) : null;
        const company = r.company_id ? await ctx.lookup("company", str(r.company_id)) : null;
        let status = STATUS[Number(r.status)];
        if (!status) {
          status = "pending";
          issues.push("Uses a custom status; imported as Pending and the original is kept as a field");
        }
        const fields = fieldMap([
          ["Status in Freshdesk", STATUS_NAME[Number(r.status)] ?? `Custom status ${r.status}`],
          ["Priority", PRIORITY[Number(r.priority)] ?? r.priority],
          ["Type", r.type],
          ["Group", group ? group.name : r.group_id],
          ["Company", company ? company.name : r.company_id],
          ["Source", SOURCE[Number(r.source)] ?? r.source],
          ["Due by", r.due_by],
          ["First response due by", r.fr_due_by],
          ["CC", r.cc_emails],
          ["Product", r.product_id],
        ]);
        for (const [k, v] of Object.entries((r.custom_fields ?? {}) as Raw)) {
          if (v === null || v === "" || v === false) continue;
          const def = await ctx.lookup("field", k);
          fields[def ? str(def.label) : k] = Array.isArray(v) ? v.join(", ") : str(v);
        }

        const messages: Msg[] = [
          {
            externalId: `description:${r.id}`,
            author: "customer",
            authorExternalId: str(r.requester_id),
            authorName: requester?.name ? str(requester.name) : null,
            authorEmail: requester?.email ? str(requester.email) : null,
            body: text(r.description_text, r.description),
            internal: false,
            createdAt: date(r.created_at),
            attachments: ((r.attachments ?? []) as Raw[]).map((a) => ({ name: str(a.name), url: str(a.attachment_url) })),
          },
        ];
        for (const c of (r._conversations ?? []) as Raw[]) {
          const agent = c.user_id ? await ctx.lookup("agent", str(c.user_id)) : null;
          const contact = !agent && c.user_id ? await ctx.lookup("contact", str(c.user_id)) : null;
          messages.push({
            externalId: str(c.id),
            author: agent ? "agent" : c.incoming || contact ? "customer" : "agent",
            authorExternalId: c.user_id ? str(c.user_id) : null,
            authorName: agent ? str(agent.contact?.name) : contact ? str(contact.name) : null,
            authorEmail: agent ? str(agent.contact?.email) || null : contact?.email ? str(contact.email) : c.from_email ? str(c.from_email) : null,
            body: text(c.body_text, c.body),
            internal: Boolean(c.private),
            createdAt: date(c.created_at),
            attachments: ((c.attachments ?? []) as Raw[]).map((a) => ({ name: str(a.name), url: str(a.attachment_url) })),
          });
        }
        if (messages.some((m) => m.attachments.length)) issues.push(ATTACHMENTS_LINKED);

        return {
          kind: "ticket",
          label: str(r.subject) || `Ticket ${r.id}`,
          skip: r.spam ? "Marked as spam in the old help desk, so it wasn't imported" : null,
          number: Number(r.id) || null,
          subject: str(r.subject) || "(no subject)",
          status,
          channel: Number(r.source) === 7 ? "chat" : "email",
          createdAt: date(r.created_at),
          updatedAt: date(r.updated_at),
          closedAt: status === "closed" ? date(r.stats?.closed_at ?? r.stats?.resolved_at ?? r.updated_at) : null,
          requester: { externalId: str(r.requester_id) || null, email: requester?.email ? str(requester.email) : null, name: requester?.name ? str(requester.name) : null },
          assigneeExternalId: r.responder_id ? str(r.responder_id) : null,
          tags: r.tags ?? [],
          fields,
          messages,
          issues,
        };
      },
    },
  ],
};
