import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { mergeCc } from "@/lib/cc";
import { normalizeTags } from "@/lib/tickets";

// Merging a ticket into another: the same customer wrote twice, or two people
// wrote about one problem. Every message and file moves to the target, which
// keeps both tickets' tags and copies, and the other ticket's customer when
// it's someone else. The merged ticket is closed and points at the target, so
// a reply to its old emails lands on the target.

const { tickets, messages, attachments, customers } = schema;

export async function mergeTickets(orgId: string, fromId: string, intoNumber: number, actor: string): Promise<{ number: number } | { error: string }> {
  return db.transaction(async (tx) => {
    const [from] = await tx.select().from(tickets).where(and(eq(tickets.orgId, orgId), eq(tickets.id, fromId))).for("update");
    const [into] = await tx.select().from(tickets).where(and(eq(tickets.orgId, orgId), eq(tickets.number, intoNumber))).for("update");
    if (!from) return { error: "That ticket doesn't exist." };
    if (!into) return { error: `There's no ticket #${intoNumber}.` };
    if (into.id === from.id) return { error: "A ticket can't be merged into itself." };
    if (from.mergedIntoId) return { error: "This ticket was already merged." };
    if (into.mergedIntoId) return { error: `#${intoNumber} was merged into another ticket. Merge into that one instead.` };

    const [fromCustomer, intoCustomer] = await Promise.all([
      tx.query.customers.findFirst({ where: eq(customers.id, from.customerId) }),
      tx.query.customers.findFirst({ where: eq(customers.id, into.customerId) }),
    ]);
    const copy = fromCustomer && fromCustomer.id !== into.customerId ? [fromCustomer.email] : [];

    await tx.update(messages).set({ ticketId: into.id }).where(and(eq(messages.orgId, orgId), eq(messages.ticketId, from.id)));
    await tx.update(attachments).set({ ticketId: into.id }).where(and(eq(attachments.orgId, orgId), eq(attachments.ticketId, from.id)));
    await tx.update(schema.sideConversations).set({ ticketId: into.id }).where(and(eq(schema.sideConversations.orgId, orgId), eq(schema.sideConversations.ticketId, from.id)));
    const now = new Date();
    await tx
      .update(tickets)
      .set({
        tags: normalizeTags([...into.tags, ...from.tags]),
        cc: mergeCc(into.cc, [...from.cc, ...copy], intoCustomer?.email ?? ""),
        status: into.status === "closed" || from.status === "open" ? "open" : into.status,
        closedAt: null,
        updatedAt: now,
      })
      .where(eq(tickets.id, into.id));
    await tx.update(tickets).set({ status: "closed", closedAt: now, mergedIntoId: into.id, updatedAt: now }).where(eq(tickets.id, from.id));
    await tx.insert(messages).values([
      { orgId, ticketId: into.id, authorType: "system", internal: true, body: `${actor} merged #${from.number} (${from.subject}) into this ticket. Its messages are above, in time order.${copy.length ? ` ${copy[0]} is now copied on replies.` : ""}`, createdAt: now },
      { orgId, ticketId: from.id, authorType: "system", internal: true, body: `${actor} merged this ticket into #${into.number}. Its messages are there now.`, createdAt: now },
    ]);
    return { number: into.number };
  });
}

// The ticket mail for a merged ticket should land on, following merges.
export async function resolveMerged(orgId: string, ticketId: string): Promise<string> {
  let id = ticketId;
  for (let i = 0; i < 5; i++) {
    const [t] = await db.select({ mergedIntoId: tickets.mergedIntoId }).from(tickets).where(and(eq(tickets.orgId, orgId), eq(tickets.id, id)));
    if (!t?.mergedIntoId) return id;
    id = t.mergedIntoId;
  }
  return id;
}
