// "Update the customer every N hours": for a ticket that stays open a while (an
// outage, a refund in review) the team promises a regular update. Setting a
// timer starts the clock; every public reply restarts it. When it runs out the
// ticket is tagged "update-due", gets a note, and posts to the alert webhook;
// then it waits another period, so a ticket nobody updates keeps reminding.
// Runs every few minutes from /api/cron/sla.

import { and, asc, eq, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { alertEvent } from "@/lib/alerts";

export const UPDATE_DUE_TAG = "update-due";
export const UPDATE_CHOICES = [
  { hours: 4, label: "4 hours" },
  { hours: 8, label: "8 hours" },
  { hours: 24, label: "Day" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "Week" },
] as const;
const BATCH = 200;

const { tickets, messages } = schema;

export const parseUpdateEvery = (raw: string): number | null => {
  const h = Number(raw);
  return UPDATE_CHOICES.some((c) => c.hours === h) ? h : null;
};

export const everyLabel = (hours: number) => UPDATE_CHOICES.find((c) => c.hours === hours)?.label.toLowerCase() ?? `${hours} hours`;

// Turn the timer on (hours) or off (null). The clock starts now.
export async function setUpdateEvery(orgId: string, ticketId: string, hours: number | null, now = new Date()) {
  await db
    .update(tickets)
    .set({
      updateEveryHours: hours,
      updateDueAt: hours ? new Date(now.getTime() + hours * 3_600_000) : null,
      ...(hours ? {} : { tags: sql`array_remove(${tickets.tags}, ${UPDATE_DUE_TAG})` }),
    })
    .where(and(eq(tickets.orgId, orgId), eq(tickets.id, ticketId)));
}

// Tickets whose update is due. Closed, trashed and snoozed ones wait: a closed ticket drops its due time.
export async function runUpdateTimers(now = new Date()): Promise<{ due: number }> {
  // Closed tickets don't owe an update; re-arm one that was reopened.
  await db.update(tickets).set({ updateDueAt: null }).where(and(eq(tickets.status, "closed"), isNotNull(tickets.updateDueAt)));
  await db
    .update(tickets)
    .set({ updateDueAt: sql`${now.toISOString()}::timestamptz + make_interval(hours => ${tickets.updateEveryHours})` })
    .where(and(ne(tickets.status, "closed"), isNotNull(tickets.updateEveryHours), isNull(tickets.updateDueAt)));

  const rows = await db
    .select()
    .from(tickets)
    .where(and(isNotNull(tickets.updateDueAt), lte(tickets.updateDueAt, now), ne(tickets.status, "closed"), isNull(tickets.deletedAt), or(isNull(tickets.snoozedUntil), lte(tickets.snoozedUntil, now))))
    .orderBy(asc(tickets.updateDueAt))
    .limit(BATCH);
  let due = 0;
  for (const t of rows) {
    if (!t.updateEveryHours) continue;
    try {
      const claimed = await db
        .update(tickets)
        .set({
          updateDueAt: new Date(now.getTime() + t.updateEveryHours * 3_600_000),
          tags: sql`case when ${tickets.tags} @> array[${UPDATE_DUE_TAG}]::text[] then ${tickets.tags} else array_append(${tickets.tags}, ${UPDATE_DUE_TAG}) end`,
          updatedAt: t.updatedAt,
        })
        .where(and(eq(tickets.id, t.id), eq(tickets.updateDueAt, t.updateDueAt!)))
        .returning({ id: tickets.id });
      if (!claimed.length) continue; // another run took it
      await db.insert(messages).values({
        orgId: t.orgId,
        ticketId: t.id,
        authorType: "system",
        internal: true,
        body: `Time to update the customer. This ticket is set to get an update every ${everyLabel(t.updateEveryHours)}. Reply to them to start the clock again.`,
      });
      await alertEvent(t.orgId, t.id, "ticket.update_due", `Set to every ${everyLabel(t.updateEveryHours)}.`);
      due++;
    } catch (err) {
      console.error("update timer failed", t.id, err);
    }
  }
  return { due };
}
