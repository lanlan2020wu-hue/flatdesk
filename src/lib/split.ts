// Splitting a ticket: a customer asks about something new in the middle of an
// old thread. The message they wrote, and the files on it, move to a new
// ticket of its own for the same customer; both tickets get a note.

import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { normalizeTags } from "@/lib/tickets";

const { tickets, messages, attachments, orgs } = schema;

export async function splitTicket(orgId: string, messageId: string, actor: string): Promise<{ number: number } | { error: string }> {
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(messages).where(and(eq(messages.orgId, orgId), eq(messages.id, messageId))).for("update");
    if (!m) return { error: "That message doesn't exist." };
    if (m.authorType !== "customer" || m.internal || m.sideId) return { error: "Only a message from the customer can start a new ticket." };
    const [from] = await tx.select().from(tickets).where(and(eq(tickets.orgId, orgId), eq(tickets.id, m.ticketId))).for("update");
    if (!from || from.deletedAt || from.mergedIntoId) return { error: "This ticket can't be split." };
    const [first] = await tx.select({ id: messages.id }).from(messages).where(and(eq(messages.ticketId, from.id), eq(messages.internal, false), eq(messages.authorType, "customer"))).orderBy(messages.createdAt).limit(1);
    if (first?.id === m.id) return { error: "That's the ticket's first message. Split a later one." };

    const [{ number }] = await tx
      .update(orgs)
      .set({ nextTicketNumber: sql`${orgs.nextTicketNumber} + 1` })
      .where(eq(orgs.id, orgId))
      .returning({ number: sql<number>`${orgs.nextTicketNumber} - 1` });
    const firstLine = m.body.trim().split("\n")[0].slice(0, 80) || "New question";
    const [created] = await tx
      .insert(tickets)
      .values({ orgId, number, subject: `${firstLine}${m.body.trim().split("\n")[0].length > 80 ? "…" : ""}`, channel: from.channel, customerId: from.customerId, tags: normalizeTags(from.tags.filter((t) => t !== "overdue")), cc: from.cc, assigneeId: from.assigneeId, groupId: from.groupId, priority: from.priority, test: from.test })
      .returning();
    await tx.update(messages).set({ ticketId: created.id }).where(eq(messages.id, m.id));
    await tx.update(attachments).set({ ticketId: created.id }).where(and(eq(attachments.orgId, orgId), eq(attachments.messageId, m.id)));
    const now = new Date();
    await tx.update(tickets).set({ updatedAt: now }).where(eq(tickets.id, from.id));
    await tx.insert(messages).values([
      { orgId, ticketId: from.id, authorType: "system", internal: true, body: `${actor} moved a message to a new ticket, #${number}.`, createdAt: new Date(now.getTime() + 1) },
      { orgId, ticketId: created.id, authorType: "system", internal: true, body: `${actor} split this out of #${from.number} (${from.subject}).`, createdAt: new Date(m.createdAt.getTime() + 1) },
    ]);
    return { number };
  });
}
