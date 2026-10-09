import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { parseTicketNumber } from "@/lib/tickets";

// Ticket search from the inbox: a ticket number ("1042" or "#1042"), or words
// matched against the subject, the customer's name and email, tags, field values and every
// message, internal notes included. All statuses, newest change first.

const { tickets, customers, messages, agents } = schema;

export const SEARCH_LIMIT = 100;

// Postgres websearch syntax: "quoted phrases", -excluded, or. Bounded so a
// pasted essay can't make a huge query.
export function cleanQuery(raw: string) {
  return raw.replace(/\0/g, "").trim().slice(0, 200);
}

export async function searchTickets(orgId: string, raw: string) {
  const q = cleanQuery(raw);
  if (!q) return [];
  const number = parseTicketNumber(q.replace(/^#/, ""));
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const words = sql`websearch_to_tsquery('simple', ${q})`;
  const match = sql`(
    ${tickets.subject} ilike ${like}
    or to_tsvector('simple', ${tickets.subject}) @@ ${words}
    or ${customers.email} ilike ${like}
    or ${customers.name} ilike ${like}
    or exists (select 1 from unnest(${tickets.tags}) tag where tag ilike ${like})
    or exists (select 1 from jsonb_each_text(${tickets.fields}) f where f.value ilike ${like})
    or exists (
      select 1 from ${messages}
      where ${messages.ticketId} = ${tickets.id}
        and to_tsvector('simple', ${messages.body}) @@ ${words}
    )
    ${number ? sql`or ${tickets.number} = ${number}` : sql``}
  )`;
  return db
    .select({
      id: tickets.id,
      number: tickets.number,
      subject: tickets.subject,
      status: tickets.status,
      priority: tickets.priority,
      channel: tickets.channel,
      tags: tickets.tags,
      updatedAt: tickets.updatedAt,
      createdAt: tickets.createdAt,
      firstResponseAt: tickets.firstResponseAt,
      source: tickets.source,
      test: tickets.test,
      resolvedByAi: tickets.resolvedByAi,
      assigneeId: tickets.assigneeId,
      assigneeName: agents.name,
      customerName: customers.name,
      customerEmail: customers.email,
      customerVip: customers.vip,
      // The first message that matched, so the row shows why it's here.
      preview: sql<string | null>`coalesce(
        (select left(${messages.body}, 200) from ${messages} where ${messages.ticketId} = ${tickets.id} and to_tsvector('simple', ${messages.body}) @@ ${words} order by ${messages.createdAt} desc limit 1),
        (select left(${messages.body}, 200) from ${messages} where ${messages.ticketId} = ${tickets.id} and ${messages.internal} = false and ${messages.authorType} <> 'system' order by ${messages.createdAt} desc limit 1)
      )`,
    })
    .from(tickets)
    .innerJoin(customers, eq(customers.id, tickets.customerId))
    .leftJoin(agents, and(eq(agents.orgId, tickets.orgId), eq(agents.userId, tickets.assigneeId)))
    .where(and(eq(tickets.orgId, orgId), match, isNull(tickets.deletedAt)))
    .orderBy(...(number ? [sql`(${tickets.number} = ${number}) desc`] : []), desc(tickets.updatedAt))
    .limit(SEARCH_LIMIT);
}
