import { and, asc, eq, gt, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { alertOverdue } from "@/lib/alerts";
import { RESOLVE_CHOICES, resolveState, slaState, TARGET_CHOICES } from "@/lib/sla";

// Escalation: when a new ticket goes past the team's first-reply target with
// no reply, or past its resolution target without being closed, Flatdesk tags
// it "overdue", leaves a note, hands it to the team's escalation person if they
// picked one, and posts to their alert webhook. Each ticket is escalated once
// for each target. Runs every few minutes from /api/cron/sla.

export const OVERDUE_TAG = "overdue";
const LOOKBACK_DAYS = 14; // older unanswered tickets were around before escalation was set up
const BATCH = 1000;
const MIN_TARGET = Math.min(...TARGET_CHOICES.map((c) => c.minutes));
const MIN_RESOLVE = Math.min(...RESOLVE_CHOICES.map((c) => c.minutes));
const RESOLVE_LOOKBACK_DAYS = 30;

const { tickets, orgs, agents } = schema;

export async function escalateOverdue(now = new Date()): Promise<{ escalated: number; resolveEscalated: number }> {
  // Candidates: unanswered tickets old enough to be late on the shortest target. Their own target is checked below.
  const rows = await db
    .select({ ticket: tickets, org: orgFields })
    .from(tickets)
    .innerJoin(orgs, eq(orgs.id, tickets.orgId))
    .where(
      and(
        eq(tickets.status, "open"),
        isNull(tickets.firstResponseAt),
        isNull(tickets.escalatedAt),
        isNull(tickets.source),
        or(isNotNull(orgs.firstResponseMinutes), sql`jsonb_array_length(${orgs.slaPolicies}) > 0`),
        gt(tickets.createdAt, new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000)),
        // No target is shorter than 15 minutes; business hours and tags are checked below.
        lte(tickets.createdAt, new Date(now.getTime() - MIN_TARGET * 60_000)),
      ),
    )
    .orderBy(asc(tickets.createdAt))
    .limit(BATCH);

  let escalated = 0;
  for (const { ticket, org } of rows) {
    if (slaState(ticket, org, now)?.kind !== "overdue") continue;
    try {
      if (await escalate(ticket, org.escalateTo, now, "reply")) escalated++;
    } catch (err) {
      console.error("escalation failed", ticket.id, err);
    }
  }

  // Resolution targets: tickets not closed in time, whether or not they got a reply.
  const late = await db
    .select({ ticket: tickets, org: orgFields })
    .from(tickets)
    .innerJoin(orgs, eq(orgs.id, tickets.orgId))
    .where(
      and(
        ne(tickets.status, "closed"),
        isNull(tickets.resolveEscalatedAt),
        isNull(tickets.source),
        or(isNotNull(orgs.resolveMinutes), sql`${orgs.slaPolicies} @? '$[*] ? (@.resolveMinutes > 0)'`),
        gt(tickets.createdAt, new Date(now.getTime() - RESOLVE_LOOKBACK_DAYS * 86_400_000)),
        lte(tickets.createdAt, new Date(now.getTime() - MIN_RESOLVE * 60_000)),
      ),
    )
    .orderBy(asc(tickets.createdAt))
    .limit(BATCH);
  let resolveEscalated = 0;
  for (const { ticket, org } of late) {
    if (resolveState(ticket, org, now)?.kind !== "overdue") continue;
    try {
      if (await escalate(ticket, org.escalateTo, now, "resolve")) resolveEscalated++;
    } catch (err) {
      console.error("resolution escalation failed", ticket.id, err);
    }
  }
  return { escalated, resolveEscalated };
}

const orgFields = {
  id: orgs.id,
  firstResponseMinutes: orgs.firstResponseMinutes,
  resolveMinutes: orgs.resolveMinutes,
  businessHours: orgs.businessHours,
  slaPolicies: orgs.slaPolicies,
  escalateTo: orgs.escalateTo,
};

async function escalate(ticket: typeof tickets.$inferSelect, escalateTo: string | null, now: Date, target: "reply" | "resolve"): Promise<boolean> {
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(tickets).where(eq(tickets.id, ticket.id)).for("update");
    // Someone may have replied or closed it since the list was read.
    if (!current) return null;
    if (target === "reply" && (current.escalatedAt || current.firstResponseAt || current.status !== "open")) return null;
    if (target === "resolve" && (current.resolveEscalatedAt || current.status === "closed")) return null;
    const lead = escalateTo
      ? await tx.query.agents.findFirst({ where: and(eq(agents.orgId, current.orgId), eq(agents.userId, escalateTo), eq(agents.viewer, false), isNull(agents.removedAt)) })
      : undefined;
    const reassign = lead && current.assigneeId !== lead.userId;
    const was = current.assigneeId ? await tx.query.agents.findFirst({ where: and(eq(agents.orgId, current.orgId), eq(agents.userId, current.assigneeId)) }) : undefined;
    await tx
      .update(tickets)
      .set({
        ...(target === "reply" ? { escalatedAt: now } : { resolveEscalatedAt: now }),
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
      body: `Missed the ${target === "reply" ? "first-reply" : "resolution"} target, so it was tagged ${OVERDUE_TAG}. ${reason}`,
      createdAt: now,
    });
    return reason;
  });
  if (result === null) return false;
  await alertOverdue(ticket.orgId, ticket.id, result, target);
  return true;
}
