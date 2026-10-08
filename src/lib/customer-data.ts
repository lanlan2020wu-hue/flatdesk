import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";

const { attachments, customers, importRecords, messages, tickets } = schema;

// Data requests from one customer (GDPR, CCPA): a copy of what the team holds
// about them, and erasing it. Both are admin-only and audited.

// Everything the customer could have seen or sent: their details, and each of
// their tickets with its customer-visible messages and file names. Internal
// notes are the team's and aren't included.
export async function customerExport(orgId: string, customerId: string) {
  const customer = await db.query.customers.findFirst({ where: and(eq(customers.orgId, orgId), eq(customers.id, customerId)) });
  if (!customer) return null;
  const theirs = await db
    .select({ id: tickets.id, number: tickets.number, subject: tickets.subject, status: tickets.status, channel: tickets.channel, createdAt: tickets.createdAt })
    .from(tickets)
    .where(and(eq(tickets.orgId, orgId), eq(tickets.customerId, customerId)))
    .orderBy(asc(tickets.createdAt));
  const ids = theirs.map((t) => t.id);
  // Messages on their tickets, and anything they wrote while copied on someone else's.
  const thread = await db
    .select({ id: messages.id, ticketId: messages.ticketId, authorType: messages.authorType, authorId: messages.authorId, body: messages.body, createdAt: messages.createdAt })
    .from(messages)
    .where(
      and(
        eq(messages.orgId, orgId),
        eq(messages.internal, false),
        sql`${messages.authorType} <> 'system'`,
        ids.length ? sql`(${inArray(messages.ticketId, ids)} or (${messages.authorType} = 'customer' and ${messages.authorId} = ${customerId}))` : sql`(${messages.authorType} = 'customer' and ${messages.authorId} = ${customerId})`,
      ),
    )
    .orderBy(asc(messages.createdAt));
  const files = thread.length
    ? await db.select({ messageId: attachments.messageId, filename: attachments.filename, size: attachments.size }).from(attachments).where(inArray(attachments.messageId, thread.map((m) => m.id)))
    : [];
  const elsewhere = thread.filter((m) => !ids.includes(m.ticketId));
  const otherNumbers = elsewhere.length
    ? new Map((await db.select({ id: tickets.id, number: tickets.number }).from(tickets).where(inArray(tickets.id, [...new Set(elsewhere.map((m) => m.ticketId))]))).map((t) => [t.id, t.number]))
    : new Map<string, number>();
  const shape = (m: (typeof thread)[number]) => ({
    from: m.authorType === "customer" ? (m.authorId === customerId ? "customer" : "another customer") : m.authorType === "ai" ? "AI" : "team",
    body: m.body,
    sentAt: m.createdAt.toISOString(),
    files: files.filter((f) => f.messageId === m.id).map((f) => ({ name: f.filename, bytes: f.size })),
  });
  return {
    exportedAt: new Date().toISOString(),
    customer: { email: customer.email, name: customer.name, fields: customer.fields, since: customer.createdAt.toISOString() },
    tickets: theirs.map((t) => ({ number: t.number, subject: t.subject, status: t.status, channel: t.channel, createdAt: t.createdAt.toISOString(), messages: thread.filter((m) => m.ticketId === t.id).map(shape) })),
    messagesOnOtherTickets: elsewhere.map((m) => ({ ticket: otherNumbers.get(m.ticketId) ?? null, ...shape(m) })),
  };
}

// Erases a customer: their tickets (with every message, note and file on
// them), what they wrote while copied on other tickets, their address on
// other tickets' CC lists, their imported records, and the customer itself.
// AI usage records stay for billing, without the link to the ticket.
// Returns what went, or null when there's no such customer.
export async function eraseCustomer(orgId: string, customerId: string) {
  return db.transaction(async (tx) => {
    const [customer] = await tx.select().from(customers).where(and(eq(customers.orgId, orgId), eq(customers.id, customerId))).for("update");
    if (!customer) return null;
    const theirs = await tx.select({ id: tickets.id }).from(tickets).where(and(eq(tickets.orgId, orgId), eq(tickets.customerId, customerId)));
    const ids = theirs.map((t) => t.id);
    const written = await tx
      .delete(messages)
      .where(and(eq(messages.orgId, orgId), eq(messages.authorType, "customer"), eq(messages.authorId, customerId), ids.length ? sql`not ${inArray(messages.ticketId, ids)}` : undefined))
      .returning({ id: messages.id });
    await tx
      .update(tickets)
      .set({ cc: sql`array_remove(${tickets.cc}, ${customer.email})` })
      .where(and(eq(tickets.orgId, orgId), sql`${customer.email} = any(${tickets.cc})`));
    if (ids.length) {
      // Other tickets merged into one of theirs now stand on their own.
      await tx.update(tickets).set({ mergedIntoId: null }).where(and(eq(tickets.orgId, orgId), inArray(tickets.mergedIntoId, ids)));
      await tx.delete(importRecords).where(and(eq(importRecords.orgId, orgId), eq(importRecords.kind, "ticket"), inArray(importRecords.mappedId, ids)));
      await tx.delete(tickets).where(and(eq(tickets.orgId, orgId), inArray(tickets.id, ids)));
    }
    await tx.delete(importRecords).where(and(eq(importRecords.orgId, orgId), eq(importRecords.kind, "contact"), eq(importRecords.mappedId, customerId)));
    await tx.delete(customers).where(eq(customers.id, customerId));
    return { email: customer.email, tickets: ids.length, otherMessages: written.length };
  });
}

// "k***@example.com", for the audit log: enough to match a request, without
// keeping the address itself.
export const maskEmail = (email: string) => email.replace(/^(.)[^@]*(@.*)$/, "$1***$2");
