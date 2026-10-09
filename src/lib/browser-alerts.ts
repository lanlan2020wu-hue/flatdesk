// Browser alerts: a desktop notification when a new ticket needs the team, or
// a ticket is given to you, while Flatdesk is open in a tab you aren't looking
// at. The app polls /api/browser-alerts (components/BrowserAlerts.tsx); each
// person turns them on in their own browser from Settings.
//
// "Needs the team" is marked once the AI has had its turn on a new ticket, the
// same moment Slack alerts go out, so tickets the AI answers stay quiet. Those
// alerts go to everyone who could pick the ticket up: it's unassigned, and has
// no group or one of yours. Assignment times are kept by a database trigger
// (migration 0051), so every way of assigning counts.

import { and, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { inMyGroups } from "@/lib/tickets";

export const BROWSER_ALERTS = {
  everyMs: 30_000, // how often an open tab asks
  limit: 5, // notifications at once; the rest are counted
  lookbackMs: 10 * 60_000, // at most this far back, after a laptop wakes
  overlapMs: 30_000, // asks a little before the last check, for changes still saving then
};

export type BrowserAlert = { key: string; kind: "new" | "assigned"; number: number; subject: string; customer: string };

const { tickets, customers } = schema;

// The AI has had its turn on a new ticket and left it to the team, or a
// ticket the AI answered went back to the team.
export async function markNeedsTeam(orgId: string, ticketId: string, handedBack = false) {
  await db
    .update(tickets)
    .set({ needsTeamAt: sql`now()` })
    .where(
      and(
        eq(tickets.orgId, orgId),
        eq(tickets.id, ticketId),
        handedBack ? undefined : and(eq(tickets.status, "open"), eq(tickets.resolvedByAi, false)),
        eq(tickets.test, false),
        isNull(tickets.deletedAt),
      ),
    );
}

// The alerts for one person since their tab last asked, and the time to ask
// from next (the database's clock, the same one the trigger uses).
export async function alertsSince(orgId: string, userId: string, since: Date | null): Promise<{ alerts: BrowserAlert[]; more: number; now: number }> {
  const [{ ms }] = await db.execute<{ ms: string }>(sql`select floor(extract(epoch from now()) * 1000)::bigint::text as ms`).then((r) => r.rows);
  const nowMs = Number(ms);
  if (!since || Number.isNaN(since.getTime())) return { alerts: [], more: 0, now: nowMs };
  const from = new Date(Math.max(since.getTime() - BROWSER_ALERTS.overlapMs, nowMs - BROWSER_ALERTS.lookbackMs));

  const assignedToMe = and(eq(tickets.assigneeId, userId), sql`${tickets.assignedAt} > ${from.toISOString()}`);
  const newForMe = and(
    sql`${tickets.needsTeamAt} > ${from.toISOString()}`,
    isNull(tickets.assigneeId),
    or(isNull(tickets.groupId), inMyGroups(orgId, userId)),
  );
  const rows = await db
    .select({
      id: tickets.id,
      number: tickets.number,
      subject: tickets.subject,
      assigneeId: tickets.assigneeId,
      assignedAt: tickets.assignedAt,
      needsTeamAt: tickets.needsTeamAt,
      customerName: customers.name,
      customerEmail: customers.email,
    })
    .from(tickets)
    .innerJoin(customers, eq(customers.id, tickets.customerId))
    .where(and(eq(tickets.orgId, orgId), isNull(tickets.deletedAt), isNull(tickets.mergedIntoId), eq(tickets.test, false), ne(tickets.status, "closed"), or(assignedToMe, newForMe)))
    .orderBy(desc(sql`greatest(${tickets.assignedAt}, ${tickets.needsTeamAt})`))
    .limit(100);

  const alerts = rows.map((r): BrowserAlert => {
    const assigned = r.assigneeId === userId && r.assignedAt !== null && r.assignedAt > from;
    const at = (assigned ? r.assignedAt : r.needsTeamAt)?.getTime() ?? 0;
    return {
      key: `${r.id}:${assigned ? "assigned" : "new"}:${at}`,
      kind: assigned ? "assigned" : "new",
      number: r.number,
      subject: r.subject,
      customer: r.customerName || r.customerEmail,
    };
  });
  return { alerts: alerts.slice(0, BROWSER_ALERTS.limit), more: Math.max(0, alerts.length - BROWSER_ALERTS.limit), now: nowMs };
}
