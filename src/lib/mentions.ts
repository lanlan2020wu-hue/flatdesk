import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { emailConfig, resend } from "@/lib/email";
import { SITE } from "@/lib/site";

// @mentions in internal notes: "@sam can you check the refund?" emails Sam a
// link to the ticket. A mention matches someone's first name, their full
// name, or the part of their email before the @, ignoring case.

type Agent = { userId: string; name: string; email: string };

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}._-]+/gu, "");

export function findMentions(body: string, team: Agent[]): Agent[] {
  const found = new Map<string, Agent>();
  for (const m of body.matchAll(/(^|[\s(])@([\p{L}\p{N}._-]+(?:\s[\p{L}\p{N}._-]+)?)/gu)) {
    const said = m[2];
    const [first, second] = said.split(/\s/);
    for (const a of team) {
      const full = norm(a.name);
      const given = norm(a.name.split(/\s+/)[0] ?? "");
      const local = norm(a.email.split("@")[0] ?? "");
      const two = second ? norm(`${first}${second}`) : null;
      if ((two && two === full) || norm(first) === given || norm(first) === local || norm(first) === full) found.set(a.userId, a);
    }
  }
  return [...found.values()];
}

// Emails the people mentioned in a note, except its author. Never throws.
export async function notifyMentions(orgId: string, ticket: { number: number; subject: string }, body: string, author: { userId: string; name: string }) {
  try {
    if (!body.includes("@")) return [];
    const team = await db
      .select({ userId: schema.agents.userId, name: schema.agents.name, email: schema.agents.email })
      .from(schema.agents)
      .where(and(eq(schema.agents.orgId, orgId), isNull(schema.agents.removedAt)));
    const to = findMentions(body, team).filter((a) => a.userId !== author.userId);
    if (!to.length || !emailConfig.apiKey || !emailConfig.from) return to;
    const url = `${SITE.url}/app/tickets/${ticket.number}`;
    for (const a of to) {
      const { error } = await resend().emails.send({
        from: `Flatdesk <${emailConfig.from}>`,
        to: a.email,
        subject: `${author.name} mentioned you on #${ticket.number}: ${ticket.subject}`.slice(0, 200),
        text: `${author.name} wrote in an internal note:\n\n${body.slice(0, 2000)}\n\nOpen the ticket: ${url}`,
      });
      if (error) console.error("mention email failed", error);
    }
    return to;
  } catch (err) {
    console.error("mentions failed", err);
    return [];
  }
}
