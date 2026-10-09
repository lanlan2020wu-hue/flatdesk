// Following a ticket: a teammate who isn't the assignee but wants to know
// what happens on it. Followers get an email when the customer writes back
// or another teammate replies or leaves a note. Replying to a ticket follows it;
// the Follow button on the ticket turns it on or off.

import { and, eq, isNull, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { emailConfig, resend } from "@/lib/email";
import { SITE } from "@/lib/site";

const { ticketFollowers, agents } = schema;

export async function setFollowing(orgId: string, ticketId: string, userId: string, on: boolean) {
  if (on) {
    await db.insert(ticketFollowers).values({ orgId, ticketId, userId }).onConflictDoNothing();
  } else {
    await db.delete(ticketFollowers).where(and(eq(ticketFollowers.orgId, orgId), eq(ticketFollowers.ticketId, ticketId), eq(ticketFollowers.userId, userId)));
  }
}

export async function followersOf(orgId: string, ticketId: string): Promise<{ userId: string; name: string }[]> {
  return db
    .select({ userId: ticketFollowers.userId, name: agents.name })
    .from(ticketFollowers)
    .innerJoin(agents, and(eq(agents.orgId, ticketFollowers.orgId), eq(agents.userId, ticketFollowers.userId), isNull(agents.removedAt)))
    .where(and(eq(ticketFollowers.orgId, orgId), eq(ticketFollowers.ticketId, ticketId)));
}

export type FollowEvent = { kind: "customer" | "reply" | "note"; actor?: string; excerpt?: string };

// "Maya replied to #1042: Where is my order?" and the first words of it.
export function followEmail(ticket: { number: number; subject: string }, event: FollowEvent): { subject: string; text: string } {
  const who = event.actor ?? "A teammate";
  const what = event.kind === "customer" ? "The customer wrote back" : event.kind === "note" ? `${who} left a note` : `${who} replied`;
  const excerpt = event.excerpt?.trim().slice(0, 500);
  return {
    subject: `${what} on #${ticket.number}: ${ticket.subject}`.slice(0, 200),
    text: `${what} on a ticket you follow.${excerpt ? `\n\n${excerpt}` : ""}\n\nOpen the ticket: ${SITE.url}/app/tickets/${ticket.number}\n\nStop following it from the ticket page.`,
  };
}

// Emails everyone following the ticket except the person who did it. Never throws.
export async function notifyFollowers(orgId: string, ticket: { id: string; number: number; subject: string }, event: FollowEvent, exceptUserId?: string) {
  try {
    if (!emailConfig.apiKey || !emailConfig.from) return;
    const rows = await db
      .select({ email: agents.email })
      .from(ticketFollowers)
      .innerJoin(agents, and(eq(agents.orgId, ticketFollowers.orgId), eq(agents.userId, ticketFollowers.userId), isNull(agents.removedAt)))
      .where(and(eq(ticketFollowers.orgId, orgId), eq(ticketFollowers.ticketId, ticket.id), exceptUserId ? ne(ticketFollowers.userId, exceptUserId) : undefined));
    const to = [...new Set(rows.map((r) => r.email).filter(Boolean))];
    if (!to.length) return;
    const { subject, text } = followEmail(ticket, event);
    for (const addr of to) {
      const { error } = await resend().emails.send({ from: `Flatdesk <${emailConfig.from}>`, to: addr, subject, text });
      if (error) console.error("follower email failed", error);
    }
  } catch (err) {
    console.error("followers failed", err);
  }
}
