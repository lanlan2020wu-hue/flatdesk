import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth";

const { tickets, messages, customers, agents, macros } = schema;

// Quotes a value for CSV, and defuses cells a spreadsheet would run as a formula.
function cell(v: unknown): string {
  let s = v == null ? "" : v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join(" ") : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const csv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

type Table = { header: string[]; rows: unknown[][] };

async function build(orgId: string, type: string): Promise<Table> {
  if (type === "messages") {
    const rows = await db
      .select({ number: tickets.number, m: messages, agent: agents.name, email: customers.email })
      .from(messages)
      .innerJoin(tickets, eq(tickets.id, messages.ticketId))
      .innerJoin(customers, eq(customers.id, tickets.customerId))
      .leftJoin(agents, and(eq(agents.orgId, messages.orgId), eq(agents.userId, messages.authorId)))
      .where(eq(messages.orgId, orgId))
      .orderBy(asc(tickets.number), asc(messages.createdAt));
    return {
      header: ["ticket_number", "created_at", "author_type", "author", "internal", "body"],
      rows: rows.map(({ number, m, agent, email }) => [number, m.createdAt, m.authorType, m.authorType === "customer" ? email : m.authorType === "agent" ? agent : m.authorType, m.internal, m.body]),
    };
  }
  if (type === "customers") {
    const rows = await db.select().from(customers).where(eq(customers.orgId, orgId)).orderBy(asc(customers.createdAt));
    return { header: ["email", "name", "created_at"], rows: rows.map((c) => [c.email, c.name, c.createdAt]) };
  }
  if (type === "macros") {
    const rows = await db.select().from(macros).where(eq(macros.orgId, orgId)).orderBy(asc(macros.name));
    return { header: ["name", "body", "add_tags", "set_status"], rows: rows.map((m) => [m.name, m.body, m.addTags, m.setStatus]) };
  }
  const rows = await db
    .select({ t: tickets, email: customers.email, name: customers.name })
    .from(tickets)
    .innerJoin(customers, eq(customers.id, tickets.customerId))
    .where(eq(tickets.orgId, orgId))
    .orderBy(asc(tickets.number));
  const agentRows = await db.select().from(agents).where(eq(agents.orgId, orgId));
  const agentName = (id: string | null) => agentRows.find((a) => a.userId === id)?.name ?? "";
  return {
    header: ["number", "subject", "status", "channel", "customer_email", "customer_name", "assignee", "tags", "created_at", "first_response_at", "closed_at", "answered_by_ai"],
    rows: rows.map(({ t, email, name }) => [t.number, t.subject, t.status, t.channel, email, name, agentName(t.assigneeId), t.tags, t.createdAt, t.firstResponseAt, t.closedAt, t.resolvedByAi]),
  };
}

const TYPES = ["tickets", "messages", "customers", "macros"];

// Everything a team owns, as CSV or JSON: ?type=tickets|messages|customers|macros&format=csv|json
export async function GET(request: Request) {
  const s = await requireSession();
  const params = new URL(request.url).searchParams;
  const type = TYPES.includes(params.get("type") ?? "") ? params.get("type")! : "tickets";
  const json = params.get("format") === "json";
  const table = await build(s.orgId, type);
  const date = new Date().toISOString().slice(0, 10);
  const body = json
    ? JSON.stringify(table.rows.map((r) => Object.fromEntries(table.header.map((h, i) => [h, r[i] instanceof Date ? (r[i] as Date).toISOString() : r[i]]))), null, 2)
    : csv(table.header, table.rows);
  return new Response(body, {
    headers: {
      "content-type": json ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="flatdesk-${type}-${date}.${json ? "json" : "csv"}"`,
      "cache-control": "no-store",
    },
  });
}
