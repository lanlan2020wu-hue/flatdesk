import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";

// Who else has a ticket open, and who is writing a reply, so two people don't
// answer the same customer (what other help desks call collision detection).
// The ticket page reports in every PRESENCE_EVERY_MS; anyone not heard from
// in STALE_AFTER_SEC has left.

export const PRESENCE_EVERY_MS = 15_000;
const STALE_AFTER_SEC = 45;

const { ticketPresence, messages, tickets } = schema;

export type Presence = { others: { name: string; typing: boolean }[]; latestMessageId: string | null };

export async function reportPresence(orgId: string, userId: string, name: string, ticketId: string, typing: boolean): Promise<Presence | null> {
  const [ticket] = await db.select({ id: tickets.id }).from(tickets).where(and(eq(tickets.orgId, orgId), eq(tickets.id, ticketId)));
  if (!ticket) return null;
  await db
    .insert(ticketPresence)
    .values({ orgId, ticketId, userId, name, typing, seenAt: new Date() })
    .onConflictDoUpdate({ target: [ticketPresence.ticketId, ticketPresence.userId], set: { name, typing, seenAt: new Date() } });
  const fresh = sql`${ticketPresence.seenAt} > now() - make_interval(secs => ${STALE_AFTER_SEC})`;
  const [others, [latest]] = await Promise.all([
    db
      .select({ name: ticketPresence.name, typing: ticketPresence.typing })
      .from(ticketPresence)
      .where(and(eq(ticketPresence.ticketId, ticketId), ne(ticketPresence.userId, userId), fresh))
      .orderBy(ticketPresence.name),
    db.select({ id: messages.id }).from(messages).where(eq(messages.ticketId, ticketId)).orderBy(desc(messages.createdAt)).limit(1),
  ]);
  return { others, latestMessageId: latest?.id ?? null };
}

export async function leaveTicket(orgId: string, userId: string, ticketId: string) {
  await db.delete(ticketPresence).where(and(eq(ticketPresence.orgId, orgId), eq(ticketPresence.ticketId, ticketId), eq(ticketPresence.userId, userId)));
}

// Old rows, so the table stays small. Run from the presence route now and then.
export async function sweepPresence() {
  await db.delete(ticketPresence).where(sql`${ticketPresence.seenAt} < now() - interval '1 day'`);
}

