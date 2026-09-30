// AI quality review. Every reply that goes to a customer, from an agent or
// from AI answers, is graded by the AI against the team's own macros, notes
// and help center: is it accurate, is the tone right, did it solve what the
// customer asked. Weak replies are flagged with what went wrong and one line
// of coaching, and the team gets a scorecard per person.
//
// Other help desks sell QA as a separate product scored on a sample. Here it
// covers every reply, inside the seat, under a fair-use limit of
// QUALITY.perAgent reviews per seat a month, pooled. It never counts toward
// the AI allowance and never shows on receipts.

import { and, asc, count, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { aiConfigured, loadKnowledge, monthKey } from "@/lib/ai";
import { access } from "@/lib/billing";
import { structuredCall } from "@/lib/llm";
import { QUALITY } from "@/lib/quality-config";

export { QUALITY };

const { orgs, agents, tickets, messages, replyReviews: reviews } = schema;

const Grade = z.object({
  accuracy: z.number().int().min(1).max(5).describe("1-5: facts, policies, links and steps agree with the team's notes and saved answers. 3 when the material doesn't cover it and nothing looks wrong."),
  tone: z.number().int().min(1).max(5).describe("1-5: clear, polite and suited to how the customer feels."),
  resolution: z.number().int().min(1).max(5).describe("1-5: answers what the customer actually asked, or clearly says what happens next."),
  overall: z.number().int().min(1).max(5).describe("1-5 overall. 5 is a reply the team would hold up as an example; 2 or below needs someone to follow up."),
  issue: z.string().describe("When overall is 2 or below: what is wrong, in one sentence. Otherwise an empty string."),
  note: z.string().describe("One short, specific coaching line for whoever wrote it. Praise what worked if nothing needs fixing."),
});
export type Grade = z.infer<typeof Grade>;

function reviewSystem(orgName: string, instructions: string, knowledge: { name: string; body: string }[]) {
  const kb = knowledge.map((m) => `<answer title="${m.name.replace(/"/g, "'")}">\n${m.body}\n</answer>`).join("\n");
  return `You review support replies for ${orgName}, the way a fair, experienced support lead would. You get the conversation up to one reply, and the reply itself. Grade only that reply.

Check it against the team's notes and saved answers below. A reply that contradicts them, invents a policy, price, date or link, or promises something the team can't do is inaccurate. Don't mark a reply down for facts the material simply doesn't mention. Judge tone against how the customer comes across. Be specific in the coaching note and never rude.

<team_notes>
${instructions.trim() || "(none)"}
</team_notes>

<saved_answers>
${kb || "(none)"}
</saved_answers>`;
}

// Scores the model returned, clamped, with the flag decided here rather than
// trusted from the model.
export function cleanGrade(g: Grade) {
  const clamp = (n: number) => (Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 3);
  const overall = clamp(g.overall);
  const flagged = overall <= QUALITY.flagAt;
  return {
    overall,
    accuracy: clamp(g.accuracy),
    tone: clamp(g.tone),
    resolution: clamp(g.resolution),
    flagged,
    issue: flagged ? g.issue.trim().slice(0, 300) || "Scored low overall." : null,
    note: g.note.trim().slice(0, 300) || "No notes.",
  };
}

// The conversation up to the reply being reviewed, newest last, internal notes
// marked. Cut from the front when long, since the latest messages matter most.
export function conversationBefore(thread: { id: string; authorType: string; internal: boolean; body: string }[], messageId: string, limit = QUALITY.threadChars) {
  const at = thread.findIndex((m) => m.id === messageId);
  if (at < 0) return null;
  const who = (m: (typeof thread)[number]) =>
    m.internal ? "Internal team note" : m.authorType === "customer" ? "Customer" : m.authorType === "ai" ? "AI assistant" : m.authorType === "system" ? "System" : "Agent";
  const parts = thread.slice(0, at).filter((m) => m.authorType !== "system").map((m) => `<message from="${who(m)}">\n${m.body.slice(0, 5000)}\n</message>`);
  let total = 0;
  const kept: string[] = [];
  for (let i = parts.length - 1; i >= 0; i--) {
    if (total + parts[i].length > limit) {
      kept.unshift("(earlier messages left out)");
      break;
    }
    kept.unshift(parts[i]);
    total += parts[i].length;
  }
  return { before: kept.join("\n"), reply: thread[at] };
}

export async function qualityRoom(orgId: string, month = monthKey()) {
  const [org, [{ seats }], [{ used }]] = await Promise.all([
    db.query.orgs.findFirst({ where: eq(orgs.id, orgId) }),
    db.select({ seats: count() }).from(agents).where(and(eq(agents.orgId, orgId), eq(agents.viewer, false))),
    db.select({ used: count() }).from(reviews).where(and(eq(reviews.orgId, orgId), eq(reviews.month, month))),
  ]);
  const trial = org ? access(org).state === "trial" : false;
  const people = trial ? Math.min(Number(seats), QUALITY.trialSeatCap) : (org?.billedSeats ?? Number(seats));
  return { used: Number(used), limit: Math.max(1, people) * QUALITY.perAgent, locked: !org || access(org).state === "locked" };
}

// Reviews one sent reply. Returns false when it was skipped. Throws on API errors.
export async function reviewReply(orgId: string, messageId: string) {
  const msg = await db.query.messages.findFirst({ where: and(eq(messages.orgId, orgId), eq(messages.id, messageId)) });
  if (!msg || msg.internal || (msg.authorType !== "agent" && msg.authorType !== "ai") || !msg.body.trim()) return false;
  const [org, thread, knowledge, ticket] = await Promise.all([
    db.query.orgs.findFirst({ where: eq(orgs.id, orgId) }),
    db.select({ id: messages.id, authorType: messages.authorType, internal: messages.internal, body: messages.body }).from(messages).where(eq(messages.ticketId, msg.ticketId)).orderBy(asc(messages.createdAt)),
    loadKnowledge(orgId),
    db.query.tickets.findFirst({ where: eq(tickets.id, msg.ticketId) }),
  ]);
  const convo = conversationBefore(thread, messageId);
  if (!org || !ticket || !convo) return false;
  const { out, metered } = await structuredCall(
    Grade,
    reviewSystem(org.name, org.aiInstructions, knowledge),
    `Subject: ${ticket.subject}\n\n<conversation>\n${convo.before || "(no earlier messages)"}\n</conversation>\n\n<reply_to_review from="${msg.authorType === "ai" ? "AI assistant" : "Agent"}">\n${msg.body.slice(0, 8000)}\n</reply_to_review>`,
  );
  if (!out) return false;
  await db
    .insert(reviews)
    .values({ orgId, ticketId: msg.ticketId, messageId, authorType: msg.authorType, authorId: msg.authorType === "agent" ? msg.authorId : null, month: monthKey(msg.createdAt), ...cleanGrade(out), model: metered.model, costUsd: metered.costUsd })
    .onConflictDoNothing();
  return true;
}

// Replies sent recently that haven't been reviewed, oldest first.
export async function pendingReplies(orgId: string, limit: number, now = new Date()) {
  const since = new Date(now.getTime() - QUALITY.lookbackDays * 86_400_000);
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .leftJoin(reviews, eq(reviews.messageId, messages.id))
    .where(
      and(
        eq(messages.orgId, orgId),
        eq(messages.internal, false),
        or(eq(messages.authorType, "agent"), eq(messages.authorType, "ai")),
        gte(messages.createdAt, since),
        lte(messages.createdAt, now),
        isNull(reviews.id),
      ),
    )
    .orderBy(asc(messages.createdAt))
    .limit(limit);
  return rows.map((r) => r.id);
}

// Reviews up to `max` waiting replies within the fair-use limit. Runs after a
// reply is sent, when the quality page loads, and from the daily cron. Never throws.
export async function reviewPending(orgId: string, max = QUALITY.perRun, deadline = Infinity) {
  if (!aiConfigured()) return 0;
  try {
    const room = await qualityRoom(orgId);
    if (room.locked) return 0;
    const n = Math.min(max, room.limit - room.used);
    if (n <= 0) return 0;
    let done = 0;
    for (const id of await pendingReplies(orgId, n)) {
      if (Date.now() > deadline) break;
      if (await reviewReply(orgId, id)) done++;
    }
    return done;
  } catch (err) {
    console.error("quality review failed", err);
    return 0;
  }
}

// Daily: catch up every team that sent replies in the last day, stopping
// before the cron function's time runs out. Whatever is left waits a day.
export async function reviewAllPending(perOrg = 20, budgetMs = 200_000) {
  const deadline = Date.now() + budgetMs;
  if (!aiConfigured()) return { orgs: 0, reviewed: 0 };
  const since = new Date(Date.now() - 86_400_000);
  const active = await db
    .selectDistinct({ orgId: messages.orgId })
    .from(messages)
    .where(and(gte(messages.createdAt, since), eq(messages.internal, false), inArray(messages.authorType, ["agent", "ai"])));
  let reviewed = 0;
  for (const { orgId } of active) {
    if (Date.now() > deadline) break;
    reviewed += await reviewPending(orgId, perOrg, deadline);
  }
  return { orgs: active.length, reviewed };
}

// ---- Reading ----------------------------------------------------------------

export type Scorecard = {
  key: string; // user id, or "ai"
  name: string;
  reviewed: number;
  average: number;
  flagged: number;
};

export async function qualitySummary(orgId: string, days = 30, now = new Date()) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const where = and(eq(reviews.orgId, orgId), gte(reviews.createdAt, since));
  const [byAuthor, flaggedRows, names] = await Promise.all([
    db
      .select({
        authorType: reviews.authorType,
        authorId: reviews.authorId,
        reviewed: count(),
        average: sql<number>`avg(${reviews.overall})`,
        flagged: sql<number>`count(*) filter (where ${reviews.flagged})`,
      })
      .from(reviews)
      .where(where)
      .groupBy(reviews.authorType, reviews.authorId),
    db
      .select({ id: reviews.id, number: tickets.number, subject: tickets.subject, authorType: reviews.authorType, authorId: reviews.authorId, overall: reviews.overall, issue: reviews.issue, note: reviews.note, at: reviews.createdAt })
      .from(reviews)
      .innerJoin(tickets, eq(tickets.id, reviews.ticketId))
      .where(and(where, eq(reviews.flagged, true)))
      .orderBy(desc(reviews.createdAt))
      .limit(20),
    db.select({ userId: agents.userId, name: agents.name }).from(agents).where(eq(agents.orgId, orgId)),
  ]);
  const nameOf = (type: string, id: string | null) => (type === "ai" ? "AI answers" : (names.find((n) => n.userId === id)?.name ?? "Former agent"));
  const cards: Scorecard[] = byAuthor
    .map((r) => ({ key: r.authorType === "ai" ? "ai" : (r.authorId ?? "unknown"), name: nameOf(r.authorType, r.authorId), reviewed: Number(r.reviewed), average: Number(r.average), flagged: Number(r.flagged) }))
    .sort((a, b) => b.reviewed - a.reviewed);
  const reviewed = cards.reduce((n, c) => n + c.reviewed, 0);
  const average = reviewed ? cards.reduce((n, c) => n + c.average * c.reviewed, 0) / reviewed : null;
  return {
    days,
    reviewed,
    average,
    flagged: cards.reduce((n, c) => n + c.flagged, 0),
    cards,
    flaggedReplies: flaggedRows.map((r) => ({ ...r, author: nameOf(r.authorType, r.authorId) })),
  };
}

export async function reviewsForMessages(orgId: string, messageIds: string[]) {
  if (!messageIds.length) return new Map<string, typeof reviews.$inferSelect>();
  const rows = await db.select().from(reviews).where(and(eq(reviews.orgId, orgId), inArray(reviews.messageId, messageIds)));
  return new Map(rows.map((r) => [r.messageId, r]));
}
