// A daily email to each person who asked for it: what's waiting on them.
// Quiet on days when there's nothing to say.

import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { emailConfig, resend } from "@/lib/email";
import { SITE } from "@/lib/site";
import { notTrashed } from "@/lib/trash";

const { tickets, agents } = schema;

export type DigestCounts = { mine: number; customerWaiting: number; unassigned: number; overdue: number };

export async function digestCounts(orgId: string, userId: string): Promise<DigestCounts> {
  const live = and(eq(tickets.orgId, orgId), notTrashed, isNull(tickets.mergedIntoId), eq(tickets.test, false), sql`(${tickets.snoozedUntil} is null or ${tickets.snoozedUntil} <= now())`);
  const [r] = await db
    .select({
      mine: sql<number>`count(*) filter (where ${tickets.assigneeId} = ${userId} and ${tickets.status} <> 'closed')::int`,
      customerWaiting: sql<number>`count(*) filter (where ${tickets.assigneeId} = ${userId} and ${tickets.status} = 'open' and ${tickets.awaitingSince} is not null)::int`,
      unassigned: sql<number>`count(*) filter (where ${tickets.assigneeId} is null and ${tickets.status} = 'open')::int`,
      overdue: sql<number>`count(*) filter (where 'overdue' = any(${tickets.tags}) and ${tickets.status} <> 'closed' and (${tickets.assigneeId} = ${userId} or ${tickets.assigneeId} is null))::int`,
    })
    .from(tickets)
    .where(live);
  return r ?? { mine: 0, customerWaiting: 0, unassigned: 0, overdue: 0 };
}

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// null when there's nothing worth an email.
export function digestEmail(name: string, c: DigestCounts, inboxUrl: string): { subject: string; text: string } | null {
  if (c.mine + c.unassigned + c.overdue === 0) return null;
  const lines = [
    c.customerWaiting > 0 && `${n(c.customerWaiting, "customer is", "customers are")} waiting on a reply from you.`,
    c.mine > 0 && `${n(c.mine, "ticket is", "tickets are")} assigned to you and not closed.`,
    c.unassigned > 0 && `${n(c.unassigned, "open ticket has", "open tickets have")} nobody on ${c.unassigned === 1 ? "it" : "them"}.`,
    c.overdue > 0 && `${n(c.overdue, "ticket is", "tickets are")} overdue.`,
  ].filter(Boolean) as string[];
  const first = name.split(/\s+/)[0] || "there";
  return {
    subject: c.customerWaiting > 0 ? `${n(c.customerWaiting, "customer is", "customers are")} waiting on you` : `${n(c.mine + c.unassigned, "ticket", "tickets")} need a look today`,
    text: `Good morning ${first},\n\n${lines.join("\n")}\n\nOpen your inbox: ${inboxUrl}\n\nYou get this because you turned on the daily summary in Settings. Turn it off there any time.`,
  };
}

export async function sendDigests(budgetMs: number): Promise<{ sent: number }> {
  if (!emailConfig.apiKey || !emailConfig.from) return { sent: 0 };
  const people = await db
    .select({ orgId: agents.orgId, userId: agents.userId, name: agents.name, email: agents.email })
    .from(agents)
    .where(and(eq(agents.digest, true), isNull(agents.removedAt)));
  const started = Date.now();
  let sent = 0;
  for (const p of people) {
    if (Date.now() - started > budgetMs) break;
    try {
      const mail = digestEmail(p.name, await digestCounts(p.orgId, p.userId), `${SITE.url}/app/inbox`);
      if (!mail || !p.email) continue;
      const { error } = await resend().emails.send({ from: `Flatdesk <${emailConfig.from}>`, to: p.email, subject: mail.subject, text: mail.text });
      if (error) console.error("digest email failed", error);
      else sent++;
    } catch (err) {
      console.error("digest failed", err);
    }
  }
  return { sent };
}
