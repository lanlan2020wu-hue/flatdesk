// Send later: a reply an agent wrote now, sent at a time they picked (the
// morning, after a weekend, once a fix ships). The sla cron sends the ones
// that are due, so they go out within a few minutes of the time.
//
// A scheduled reply is held, not sent, when the customer wrote again after it
// was scheduled, or the ticket or its writer is gone: the ticket shows it with
// Send now and Cancel so a person decides. Attachments aren't scheduled;
// replies with files go out right away.

import { and, asc, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { handBackToTeam } from "@/lib/ai";
import { access } from "@/lib/billing";
import { deliverReply } from "@/lib/email";
import { recordMacroUses } from "@/lib/macro-drift";
import { blockedFromClosing } from "@/lib/ticket-fields";
import { addReply, type TicketStatus } from "@/lib/tickets";

export const SCHEDULE = {
  minMs: 60_000, // at least a minute ahead
  maxDays: 60,
  perTicket: 5,
  batch: 50, // sent per cron run
};

export class ScheduleError extends Error {}

const { scheduledReplies, tickets, messages, agents, orgs } = schema;

export type ScheduledReply = typeof scheduledReplies.$inferSelect;

// The time from the composer (an ISO string the browser made from the
// agent's own clock and time zone).
export function parseSendAt(raw: string, now = new Date()): Date {
  const at = new Date(raw);
  if (!raw || Number.isNaN(at.getTime())) throw new ScheduleError("Pick when to send it.");
  if (at.getTime() < now.getTime() + SCHEDULE.minMs) throw new ScheduleError("Pick a time at least a minute from now.");
  if (at.getTime() > now.getTime() + SCHEDULE.maxDays * 86_400_000) throw new ScheduleError(`A reply can be scheduled up to ${SCHEDULE.maxDays} days ahead.`);
  return at;
}

export async function scheduleReply(input: {
  orgId: string;
  ticketId: string;
  userId: string;
  body: string;
  original?: string | null;
  nextStatus: TicketStatus;
  addTags?: string[];
  assignTo?: string | null;
  macroIds?: string[];
  sendAt: Date;
}) {
  const body = input.body.trim();
  if (!body) throw new ScheduleError("Write the reply first, then pick when to send it.");
  const ticket = await db.query.tickets.findFirst({ where: and(eq(tickets.orgId, input.orgId), eq(tickets.id, input.ticketId)) });
  if (!ticket || ticket.deletedAt || ticket.mergedIntoId) throw new ScheduleError("This ticket can't take replies right now.");
  const waiting = await db
    .select({ id: scheduledReplies.id })
    .from(scheduledReplies)
    .where(and(eq(scheduledReplies.ticketId, input.ticketId), inArray(scheduledReplies.status, ["scheduled", "held"])));
  if (waiting.length >= SCHEDULE.perTicket) throw new ScheduleError(`A ticket can have up to ${SCHEDULE.perTicket} replies waiting. Send or cancel one first.`);
  const [row] = await db
    .insert(scheduledReplies)
    .values({
      orgId: input.orgId,
      ticketId: input.ticketId,
      userId: input.userId,
      body,
      original: input.original ?? null,
      nextStatus: input.nextStatus,
      addTags: input.addTags ?? [],
      assignTo: input.assignTo ?? null,
      macroIds: input.macroIds ?? [],
      sendAt: input.sendAt,
    })
    .returning();
  return row;
}

// The replies waiting on a ticket, soonest first.
export function waitingOn(orgId: string, ticketId: string) {
  return db
    .select()
    .from(scheduledReplies)
    .where(and(eq(scheduledReplies.orgId, orgId), eq(scheduledReplies.ticketId, ticketId), inArray(scheduledReplies.status, ["scheduled", "held"])))
    .orderBy(asc(scheduledReplies.sendAt));
}

// Cancelled replies come back to the reply box, so this returns the text.
export async function cancelScheduled(orgId: string, id: string) {
  const [row] = await db
    .update(scheduledReplies)
    .set({ status: "cancelled" })
    .where(and(eq(scheduledReplies.orgId, orgId), eq(scheduledReplies.id, id), inArray(scheduledReplies.status, ["scheduled", "held"])))
    .returning();
  return row ?? null;
}

type Outcome = { sent: true; messageId: string } | { sent: false; reason: string };

async function hold(id: string, reason: string): Promise<Outcome> {
  await db.update(scheduledReplies).set({ status: "held", heldReason: reason }).where(eq(scheduledReplies.id, id));
  return { sent: false, reason };
}

// Sends one waiting reply. `now` (Send now on the ticket) skips the check for
// a newer customer message: the person pressing it has seen the ticket.
export async function sendScheduled(orgId: string, id: string, opts: { now?: boolean } = {}): Promise<Outcome> {
  // Claimed first, so the cron and a Send now click can't both send it.
  const [row] = await db
    .update(scheduledReplies)
    .set({ status: "sent" })
    .where(and(eq(scheduledReplies.orgId, orgId), eq(scheduledReplies.id, id), opts.now ? inArray(scheduledReplies.status, ["scheduled", "held"]) : eq(scheduledReplies.status, "scheduled")))
    .returning();
  if (!row) return { sent: false, reason: "It was already sent or cancelled." };

  const [ticket, writer, org] = await Promise.all([
    db.query.tickets.findFirst({ where: and(eq(tickets.orgId, orgId), eq(tickets.id, row.ticketId)) }),
    db.query.agents.findFirst({ where: and(eq(agents.orgId, orgId), eq(agents.userId, row.userId), isNull(agents.removedAt)) }),
    db.query.orgs.findFirst({ where: eq(orgs.id, orgId) }),
  ]);
  if (!ticket || ticket.deletedAt || ticket.mergedIntoId) return hold(row.id, "The ticket was deleted or merged.");
  if (!writer || writer.viewer) return hold(row.id, "Whoever wrote it is no longer an agent on the team.");
  if (!org || access(org).state === "locked") return hold(row.id, "The team's trial ended before it was sent.");
  if (!opts.now) {
    const [newer] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.ticketId, row.ticketId), eq(messages.authorType, "customer"), gt(messages.createdAt, row.createdAt)))
      .limit(1);
    if (newer) return hold(row.id, "The customer wrote again after this was scheduled.");
  }

  try {
    let status: TicketStatus = row.nextStatus;
    if (status === "closed" && (await blockedFromClosing(orgId, [row.ticketId])).get(row.ticketId)) status = "pending";
    const { messageId, ticket: after } = await addReply({
      orgId,
      ticketId: row.ticketId,
      userId: row.userId,
      body: row.body,
      original: row.original,
      internal: false,
      status,
      addTags: row.addTags,
      assignTo: row.assignTo,
    });
    if (!messageId) return hold(row.id, "There was nothing to send.");
    await db.update(scheduledReplies).set({ messageId }).where(eq(scheduledReplies.id, row.id));
    await deliverReply(orgId, messageId);
    if (after.resolvedByAi) await handBackToTeam(orgId, row.ticketId, "A person on the team replied.", false);
    if (row.macroIds.length) await recordMacroUses(orgId, messageId, row.macroIds);
    return { sent: true, messageId };
  } catch (err) {
    console.error("scheduled reply failed", row.id, err);
    return hold(row.id, "Sending failed. Try Send now.");
  }
}

// The cron's part: every reply whose time has come.
export async function sendDueReplies(now = new Date()) {
  const due = await db
    .select({ id: scheduledReplies.id, orgId: scheduledReplies.orgId })
    .from(scheduledReplies)
    .where(and(eq(scheduledReplies.status, "scheduled"), lte(scheduledReplies.sendAt, now)))
    .orderBy(asc(scheduledReplies.sendAt))
    .limit(SCHEDULE.batch);
  let sent = 0;
  let held = 0;
  for (const d of due) {
    const r = await sendScheduled(d.orgId, d.id);
    if (r.sent) sent++;
    else held++;
  }
  return { sent, held };
}

