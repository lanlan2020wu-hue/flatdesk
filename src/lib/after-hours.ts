// An automatic reply for new email tickets that arrive while the team is
// closed ("We're offline until 9am and will reply first thing"). Sent once,
// only when business hours are set, and only if the AI didn't already answer.

import { and, eq, ne, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { deliverReply } from "@/lib/email";
import { isOpenNow } from "@/lib/sla";

const { messages, orgs, tickets } = schema;

export const AFTER_HOURS_MAX = 1000;

export function cleanAfterHoursMessage(raw: unknown): string {
  return String(raw ?? "").replace(/\0/g, "").replace(/\r\n?/g, "\n").trim().slice(0, AFTER_HOURS_MAX);
}

// Never throws: a missing away message must not break the new ticket.
export async function sendAfterHoursReply(orgId: string, ticketId: string, now = new Date()): Promise<boolean> {
  try {
    const [row] = await db
      .select({ message: orgs.afterHoursMessage, hours: orgs.businessHours, channel: tickets.channel, test: tickets.test, source: tickets.source, resolvedByAi: tickets.resolvedByAi })
      .from(tickets)
      .innerJoin(orgs, eq(orgs.id, tickets.orgId))
      .where(and(eq(tickets.orgId, orgId), eq(tickets.id, ticketId)));
    if (!row || !row.message.trim() || !row.hours || row.channel !== "email" || row.test || row.source || row.resolvedByAi) return false;
    if (isOpenNow(row.hours, now)) return false;
    // Anyone, human or AI, already answered; or this reply already went out.
    const [answered] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.ticketId, ticketId), eq(messages.internal, false), ne(messages.authorType, "customer"), or(eq(messages.authorType, "agent"), eq(messages.authorType, "ai"), eq(messages.authorType, "system"))))
      .limit(1);
    if (answered) return false;
    const [sent] = await db.insert(messages).values({ orgId, ticketId, authorType: "system", internal: false, body: row.message }).returning({ id: messages.id });
    await deliverReply(orgId, sent.id);
    return true;
  } catch (err) {
    console.error("after-hours reply failed", err);
    return false;
  }
}
