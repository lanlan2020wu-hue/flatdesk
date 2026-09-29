import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { RATINGS, type Rating } from "@/lib/csat-ratings";
import { SITE } from "@/lib/site";

// One-click satisfaction ratings. Every reply email (an agent's or the AI's)
// ends with three links; a click rates that reply. The rating page records the
// click from the browser, not on the GET itself, so mail scanners that fetch
// every link don't leave ratings. See app/rate/[id]/[rating].

export { RATINGS, RATING_LABEL, isRating, type Rating } from "@/lib/csat-ratings";

// Two different ratings of one reply this close together, both straight from
// email links, are a link scanner opening every link, not a person. Both are
// dropped. Changing the rating on the rating page itself is always allowed.
export const SCANNER_WINDOW_MS = 15_000;

export function ratingUrl(messageId: string, rating: Rating) {
  return `${SITE.url}/rate/${messageId}/${rating}`;
}

export function csatText(messageId: string) {
  return `\n\n--\nHow did we do? One click rates this reply:\n${RATINGS.map((r) => `${r.label}: ${ratingUrl(messageId, r.id)}`).join("\n")}`;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The reply as HTML, so the rating links can be buttons. The body stays plain
// text: escaped and shown with its line breaks.
export function replyHtml(body: string, messageId: string | null) {
  const text = `<div style="white-space:pre-wrap;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#14201b">${escapeHtml(body)}</div>`;
  if (!messageId) return text;
  const buttons = RATINGS.map(
    (r) =>
      `<a href="${escapeHtml(ratingUrl(messageId, r.id))}" style="display:inline-block;margin:0 6px 6px 0;padding:8px 14px;border:1px solid #cfc8b9;border-radius:999px;color:#14201b;text-decoration:none;font-size:14px">${r.emoji} ${r.label}</a>`,
  ).join("");
  return `${text}<div style="margin-top:24px;padding-top:12px;border-top:1px solid #e3ded3;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:13px;color:#5b6660"><p style="margin:0 0 8px">How did we do? One click rates this reply.</p>${buttons}</div>`;
}

// The reply a rating link points at, if it can be rated: a sent reply from an
// agent or the AI.
export async function ratableReply(messageId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(messageId)) return null;
  const [row] = await db
    .select({ message: schema.messages, ticket: schema.tickets, org: schema.orgs })
    .from(schema.messages)
    .innerJoin(schema.tickets, eq(schema.tickets.id, schema.messages.ticketId))
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.messages.orgId))
    .where(eq(schema.messages.id, messageId));
  if (!row || row.message.internal || (row.message.authorType !== "agent" && row.message.authorType !== "ai")) return null;
  return row;
}

export type RecordResult = { ok: true; rating: Rating; handBack: boolean } | { ok: false; error: string };

// Saves the rating (or changes it). Returns handBack when a "Not good" lands on
// an AI answer the ticket still counts, so the caller hands it to the team.
export async function recordRating(messageId: string, rating: Rating, opts: { change?: boolean; now?: Date } = {}): Promise<RecordResult> {
  const now = opts.now ?? new Date();
  const found = await ratableReply(messageId);
  if (!found) return { ok: false, error: "This reply can't be rated." };
  const { message, ticket } = found;
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(schema.csatRatings).where(eq(schema.csatRatings.messageId, messageId)).for("update");
    if (existing && !opts.change && existing.rating !== rating && now.getTime() - existing.updatedAt.getTime() < SCANNER_WINDOW_MS) {
      await tx.delete(schema.csatRatings).where(eq(schema.csatRatings.id, existing.id));
      return { ok: false as const, error: "We couldn't save that rating. Please try again in a moment." };
    }
    await tx
      .insert(schema.csatRatings)
      .values({
        orgId: message.orgId,
        ticketId: ticket.id,
        messageId,
        rating,
        ratedAuthorType: message.authorType,
        agentId: message.authorType === "agent" ? message.authorId : null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({ target: schema.csatRatings.messageId, set: { rating, updatedAt: now } });
    return { ok: true as const, rating, handBack: rating === "bad" && message.authorType === "ai" && ticket.resolvedByAi };
  });
}

export async function saveComment(messageId: string, comment: string) {
  const text = comment.trim().slice(0, 2000);
  if (!text) return;
  await db.update(schema.csatRatings).set({ comment: text }).where(eq(schema.csatRatings.messageId, messageId));
}

export async function ratingsForTicket(orgId: string, ticketId: string) {
  const rows = await db
    .select({ messageId: schema.csatRatings.messageId, rating: schema.csatRatings.rating, comment: schema.csatRatings.comment })
    .from(schema.csatRatings)
    .where(and(eq(schema.csatRatings.orgId, orgId), eq(schema.csatRatings.ticketId, ticketId)));
  return new Map(rows.map((r) => [r.messageId, r]));
}

// Share of ratings that were "Great", for the team, the AI and each agent.
export async function csatReport(orgId: string, since: Date) {
  const rows = await db
    .select({
      who: schema.csatRatings.ratedAuthorType,
      agentId: schema.csatRatings.agentId,
      total: sql<number>`count(*)::int`,
      great: sql<number>`(count(*) filter (where ${schema.csatRatings.rating} = 'great'))::int`,
      bad: sql<number>`(count(*) filter (where ${schema.csatRatings.rating} = 'bad'))::int`,
    })
    .from(schema.csatRatings)
    .where(and(eq(schema.csatRatings.orgId, orgId), gte(schema.csatRatings.createdAt, since)))
    .groupBy(schema.csatRatings.ratedAuthorType, schema.csatRatings.agentId);
  const sum = (rs: typeof rows) => rs.reduce((a, r) => ({ total: a.total + r.total, great: a.great + r.great, bad: a.bad + r.bad }), { total: 0, great: 0, bad: 0 });
  return {
    all: sum(rows),
    ai: sum(rows.filter((r) => r.who === "ai")),
    team: sum(rows.filter((r) => r.who === "agent")),
    byAgent: new Map(rows.filter((r) => r.agentId).map((r) => [r.agentId!, { total: r.total, great: r.great, bad: r.bad }])),
  };
}

export const csatScore = (s: { total: number; great: number }) => (s.total ? s.great / s.total : null);
