import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";

const { tickets, messages } = schema;

// Snoozing puts a ticket away until a time someone picks ("tomorrow morning",
// "next week") and brings it back to Open then, with a note. The ticket keeps
// its status meanwhile; it just leaves the working views for the Snoozed one.
// A customer message wakes it at once.

export const MAX_SNOOZE_DAYS = 365;

// Working views and counts show tickets that aren't snoozed, or whose time has
// come even if the wake-up job hasn't run yet.
export const awake = sql`(${tickets.snoozedUntil} is null or ${tickets.snoozedUntil} <= now())`;
// The Snoozed view. A ticket closed while snoozed shows under Closed instead.
export const snoozed = sql`(${tickets.snoozedUntil} is not null and ${tickets.snoozedUntil} > now() and ${tickets.status} <> 'closed')`;

// The time from the form: a moment at least a minute ahead and at most a year.
export function parseSnoozeUntil(raw: unknown, now = new Date()): Date | null {
  if (typeof raw !== "string" || raw.length > 40) return null;
  const at = new Date(raw);
  const t = at.getTime();
  if (!Number.isFinite(t) || t < now.getTime() + 60_000 || t > now.getTime() + MAX_SNOOZE_DAYS * 86_400_000) return null;
  return at;
}

// "Tue, Oct 14, 9:00 AM UTC": notes are read by people in any time zone.
export const snoozeLabel = (at: Date) => `${at.toLocaleString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} UTC`;

export async function snoozeTicket(orgId: string, ticketId: string, until: Date, by: string): Promise<boolean> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [t] = await tx
      .update(tickets)
      .set({ snoozedUntil: until, snoozedBy: by, updatedAt: now })
      .where(and(eq(tickets.orgId, orgId), eq(tickets.id, ticketId), isNull(tickets.deletedAt), isNull(tickets.mergedIntoId)))
      .returning({ id: tickets.id });
    if (!t) return false;
    await tx.insert(messages).values({ orgId, ticketId, authorType: "system", internal: true, body: `Snoozed by ${by} until ${snoozeLabel(until)}. It comes back to Open then, or sooner if the customer writes.`, createdAt: now });
    return true;
  });
}

// Wakes one ticket now, from the ticket page.
export async function unsnoozeTicket(orgId: string, ticketId: string, by: string): Promise<boolean> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [t] = await tx
      .update(tickets)
      .set({ snoozedUntil: null, snoozedBy: null, updatedAt: now })
      .where(and(eq(tickets.orgId, orgId), eq(tickets.id, ticketId), sql`${tickets.snoozedUntil} is not null`))
      .returning({ id: tickets.id });
    if (!t) return false;
    await tx.insert(messages).values({ orgId, ticketId, authorType: "system", internal: true, body: `Woken early by ${by}.`, createdAt: now });
    return true;
  });
}

// Every few minutes: tickets whose snooze is up come back to Open (a closed
// one stays closed) with a note, and count as just updated, so timed
// triggers start their clocks from now. Returns how many woke.
export async function wakeSnoozed(now = new Date(), orgId?: string): Promise<number> {
  return db.transaction(async (tx) => {
    const woke = await tx
      .update(tickets)
      .set({ status: sql`(case when ${tickets.status} = 'closed' then 'closed' else 'open' end)::ticket_status`, snoozedUntil: null, snoozedBy: null, updatedAt: now })
      .where(and(lte(tickets.snoozedUntil, now), isNull(tickets.deletedAt), orgId ? eq(tickets.orgId, orgId) : undefined))
      .returning({ id: tickets.id, orgId: tickets.orgId, status: tickets.status });
    if (woke.length) {
      await tx.insert(messages).values(woke.map((t) => ({ orgId: t.orgId, ticketId: t.id, authorType: "system" as const, internal: true, body: t.status === "closed" ? "Snooze ended. The ticket was closed meanwhile, so it stays closed." : "Snooze ended. Back in Open.", createdAt: now })));
    }
    return woke.length;
  });
}
