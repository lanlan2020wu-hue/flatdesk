import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { alertOverdue } from "@/lib/alerts";
import { slaState } from "@/lib/sla";

// Escalation: when a new ticket goes past the team's first-reply target with
// no reply, Flatdesk tags it "overdue", leaves a note, hands it to the team's
// escalation person if they picked one, and posts to their alert webhook.
// Each ticket is escalated once. Runs every few minutes from /api/cron/sla.

export const OVERDUE_TAG = "overdue";
const LOOKBACK_DAYS = 14; // older unanswered tickets were around before escalation was set up
const BATCH = 1000;

const { tickets, orgs, agents } = schema;

export async function escalateOverdue(now = new Date()): Promise<{ escalated: number }> {
  // Can only be late once the target has passed on the wall clock (business hours only push it later).
  const rows = await db
    .select({ ticket: tickets, org: { id: orgs.id, firstResponseMinutes: orgs.firstResponseMinutes, businessHours: orgs.businessHours, escalateTo: orgs.escalateTo } })
    .from(tickets)
    .innerJoin(orgs, eq(orgs.id, tickets.orgId))
    .where(
      and(
        eq(tickets.status, "open"),
        isNull(tickets.firstResponseAt),
        isNull(tickets.escalatedAt),
        isNull(tickets.source),
        isNotNull(orgs.firstResponseMinutes),
        gt(tickets.createdAt, new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000)),
        sql`${tickets.createdAt} <= ${now.toISOString()}::timestamptz - (${orgs.firstResponseMinutes} * interval '1 minute')`,
      ),
    )
    .limit(BATCH);

  let escalated = 0;
  for (const { ticket, org } of rows) {
    if (slaState(ticket, org, now)?.kind !== "overdue") continue;
    try {
      if (await escalate(ticket, org.escalateTo, now)) escalated++;
    } catch (err) {
      console.error("escalation failed", ticket.id, err);
    }
  }
  return { escalated };
}

async function escalate(ticket: typeof tickets.$inferSelect, escalateTo: string | null, now: Date): Promise<boolean> {
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(tickets).where(eq(tickets.id, ticket.id)).for("update");
    // Someone may have replied or closed it since the list was read.
    if (!current || current.escalatedAt || current.firstResponseAt || current.status !== "open") return null;
    const lead = escalateTo
      ? await tx.query.agents.findFirst({ where: and(eq(agents.orgId, current.orgId), eq(agents.userId, escalateTo), eq(agents.viewer, false), isNull(agents.removedAt)) })
      : undefined;
    const reassign = lead && current.assigneeId !== lead.userId;
    const was = current.assigneeId ? await tx.query.agents.findFirst({ where: and(eq(agents.orgId, current.orgId), eq(agents.userId, current.assigneeId)) }) : undefined;
    await tx
      .update(tickets)
      .set({
        escalatedAt: now,
        tags: current.tags.includes(OVERDUE_TAG) ? current.tags : [...current.tags, OVERDUE_TAG],
        ...(reassign ? { assigneeId: lead.userId } : {}),
      })
      .where(eq(tickets.id, current.id));
    const reason = reassign ? `Handed to ${lead.name}${was ? ` (it was with ${was.name})` : ""}.` : was ? `It's with ${was.name}.` : "Nobody has it yet.";
    await tx.insert(schema.messages).values({
      orgId: current.orgId,
      ticketId: current.id,
      authorType: "system",
      internal: true,
      body: `Missed the first-reply target, so it was tagged ${OVERDUE_TAG}. ${reason}`,
      createdAt: now,
    });
    return reason;
  });
  if (result === null) return false;
  await alertOverdue(ticket.orgId, ticket.id, result);
  return true;
}
