import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { InsightTopic } from "@/db/schema";
import { aiConfigured } from "@/lib/ai";
import { structuredCall } from "@/lib/llm";

// AI insights: what customers asked about over the last days, grouped into
// topics, with where the AI handed off and why, and one thing to do about
// each. On demand from Reports, at most once every INSIGHTS.everyHours per
// team, over at most INSIGHTS.maxTickets tickets. It never counts toward the
// AI allowance or the copilot limit.

export const INSIGHTS = { maxTickets: 300, everyHours: 12, maxTopics: 10 };

export class InsightsError extends Error {}

const { tickets, insights } = schema;

export type InsightTicket = { id: string; number: number; subject: string; first: string; tags: string[]; outcome: "ai" | "handoff" | "team"; reason: string | null };

// The window's tickets as the model reads them: newest first, test tickets left out.
export async function insightTickets(orgId: string, days: number, limit = INSIGHTS.maxTickets): Promise<InsightTicket[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({
      id: tickets.id,
      number: tickets.number,
      subject: tickets.subject,
      tags: tickets.tags,
      resolvedByAi: tickets.resolvedByAi,
      // Aliased by hand: in a one-table select, drizzle leaves column names
      // unqualified, so "id" would resolve to the subquery's own table.
      first: sql<string | null>`(select left(m.body, 400) from messages m where m.ticket_id = ${tickets}.id and m.author_type = 'customer' order by m.created_at limit 1)`,
      reason: sql<string | null>`(select e.reason from ai_events e where e.ticket_id = ${tickets}.id and e.kind = 'handoff' order by e.created_at desc limit 1)`,
      handedOff: sql<boolean>`exists (select 1 from ai_events e where e.ticket_id = ${tickets}.id and e.kind = 'handoff')`,
    })
    .from(tickets)
    .where(and(eq(tickets.orgId, orgId), gte(tickets.createdAt, since), eq(tickets.test, false), sql`${tickets.mergedIntoId} is null`))
    .orderBy(desc(tickets.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    subject: r.subject,
    first: (r.first ?? "").replace(/\s+/g, " ").trim(),
    tags: r.tags,
    outcome: r.resolvedByAi ? "ai" : r.handedOff ? "handoff" : "team",
    reason: r.reason,
  }));
}

export function insightPrompt(list: InsightTicket[]): string {
  const outcome = (t: InsightTicket) =>
    t.outcome === "ai" ? "AI answered it" : t.outcome === "handoff" ? `AI handed it to the team${t.reason ? `: ${t.reason.slice(0, 160)}` : ""}` : "the team answered it";
  return list
    .map((t, i) => `[${i + 1}] ${t.subject.slice(0, 150)}\n${t.first.slice(0, 300)}${t.tags.length ? `\ntags: ${t.tags.join(", ")}` : ""}\noutcome: ${outcome(t)}`)
    .join("\n\n");
}

const Output = z.object({
  topics: z
    .array(
      z.object({
        name: z.string().describe("2 to 5 words, in the customers' terms, like 'Where is my order' or 'Refund requests'."),
        summary: z.string().describe("One sentence on what these customers want."),
        tickets: z.array(z.number().int()).describe("The numbers in brackets of every ticket in this topic."),
        gap: z.string().describe("If the AI handed several of these to the team, why, in one sentence (what it was missing). Empty if it handled them or wasn't involved."),
        suggestion: z.string().describe("One concrete thing the team could do: a help article, a macro, a fact for the AI, a product fix. Empty if nothing stands out."),
      }),
    )
    .describe("The main topics, biggest first."),
  notes: z.array(z.string()).describe("Up to 3 short observations worth knowing (a spike, an angry pattern, a recurring bug). Empty if none."),
});

const SYSTEM = `You read a support team's recent tickets and tell them what customers are asking about. Group the tickets into at most ${INSIGHTS.maxTopics} topics by what the customer wants, biggest first. Put each ticket in exactly one topic; use a topic named "Other" only for tickets that fit nowhere else. Say only what the tickets show, never guess at numbers; the team sees counts computed from your grouping. Plain text, no markdown.`;

export async function latestInsight(orgId: string) {
  const [row] = await db.select().from(insights).where(eq(insights.orgId, orgId)).orderBy(desc(insights.createdAt)).limit(1);
  return row ?? null;
}

// When the team can run insights again, or null if it can now.
export function nextRunAt(last: { createdAt: Date } | null, now = new Date()): Date | null {
  if (!last) return null;
  const next = new Date(last.createdAt.getTime() + INSIGHTS.everyHours * 3600_000);
  return next > now ? next : null;
}

export async function runInsights(orgId: string, userId: string, days: number) {
  if (!aiConfigured()) throw new InsightsError("AI isn't set up on this workspace yet.");
  const wait = nextRunAt(await latestInsight(orgId));
  if (wait) {
    const hours = Math.max(1, Math.ceil((wait.getTime() - Date.now()) / 3600_000));
    throw new InsightsError(`Insights refresh every ${INSIGHTS.everyHours} hours. Try again in ${hours} ${hours === 1 ? "hour" : "hours"}.`);
  }
  const list = await insightTickets(orgId, days);
  if (list.length < 5) throw new InsightsError("There aren't enough tickets in this window yet. Insights need at least 5.");
  const { out, metered } = await structuredCall(orgId, Output, SYSTEM, insightPrompt(list), { timeout: 180_000, maxRetries: 1 });
  if (!out) throw new InsightsError("The AI couldn't read these tickets. Try again later.");
  const topics: InsightTopic[] = out.topics.slice(0, INSIGHTS.maxTopics + 1).flatMap((t) => {
    const ids = [...new Set(t.tickets)].filter((n) => n >= 1 && n <= list.length).map((n) => list[n - 1].id);
    return ids.length ? [{ name: t.name.slice(0, 80), summary: t.summary.slice(0, 300), ticketIds: ids, gap: t.gap.slice(0, 300), suggestion: t.suggestion.slice(0, 300) }] : [];
  });
  topics.sort((a, b) => b.ticketIds.length - a.ticketIds.length);
  const [row] = await db
    .insert(insights)
    .values({ orgId, days, tickets: list.length, topics, notes: out.notes.slice(0, 3).map((n) => n.slice(0, 300)), createdBy: userId, model: metered.model, costUsd: metered.costUsd })
    .returning();
  return row;
}

// Live numbers for each topic's tickets: how many the AI answered, how many it
// handed to the team, how many are still open, and a few to look at.
export async function topicStats(orgId: string, topics: InsightTopic[]) {
  const ids = [...new Set(topics.flatMap((t) => t.ticketIds))];
  if (!ids.length) return [];
  const rows = await db
    .select({
      id: tickets.id,
      number: tickets.number,
      subject: tickets.subject,
      status: tickets.status,
      resolvedByAi: tickets.resolvedByAi,
      handedOff: sql<boolean>`exists (select 1 from ai_events e where e.ticket_id = ${tickets}.id and e.kind = 'handoff')`,
    })
    .from(tickets)
    .where(and(eq(tickets.orgId, orgId), inArray(tickets.id, ids)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return topics.map((t) => {
    const mine = t.ticketIds.map((id) => byId.get(id)).filter((r) => r !== undefined);
    return {
      ...t,
      count: mine.length,
      ai: mine.filter((r) => r.resolvedByAi).length,
      handedOff: mine.filter((r) => !r.resolvedByAi && r.handedOff).length,
      open: mine.filter((r) => r.status !== "closed").length,
      examples: mine.slice(0, 5).map((r) => ({ number: r.number, subject: r.subject })),
    };
  });
}
