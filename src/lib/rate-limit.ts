import { createHash } from "node:crypto";
import { lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";

// Spam limits for the endpoints anyone on the internet can call: the chat
// widget and the waitlist. Counts live in Postgres (rate_limits), so they hold
// across serverless instances. Visitors are keyed by a hash of their IP.

const { rateLimits } = schema;

// cost: how much this hit counts (a message with three files costs 3 against a file limit).
export type Limit = { key: string; max: number; windowSec: number; cost?: number };
export type Verdict = { ok: true } | { ok: false; retryAfter: number };

// The caller's IP. On Vercel, x-forwarded-for is set by the edge and its first
// entry is the client; x-real-ip is the same address.
export function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

export function ipKey(request: Request) {
  return createHash("sha256").update(`flatdesk:${clientIp(request)}`).digest("base64url").slice(0, 22);
}

// Counts one hit against each limit and says whether all of them still allow it.
// A hit is counted even when refused, so hammering doesn't reset the window.
export async function hit(limits: Limit[], now = new Date()): Promise<Verdict> {
  let retryAfter = 0;
  for (const l of limits) {
    const cost = l.cost ?? 1;
    if (cost <= 0) continue;
    const reset = new Date(now.getTime() + l.windowSec * 1000);
    const [row] = await db
      .insert(rateLimits)
      .values({ key: l.key, count: cost, resetAt: reset })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          count: sql`case when ${rateLimits.resetAt} <= ${now} then ${cost} else ${rateLimits.count} + ${cost} end`,
          resetAt: sql`case when ${rateLimits.resetAt} <= ${now} then ${reset} else ${rateLimits.resetAt} end`,
        },
      })
      .returning();
    if (row.count > l.max) retryAfter = Math.max(retryAfter, Math.ceil((row.resetAt.getTime() - now.getTime()) / 1000));
  }
  // Now and then, clear out windows that ended a day ago.
  if (Math.random() < 0.01) await db.delete(rateLimits).where(lt(rateLimits.resetAt, new Date(now.getTime() - 86_400_000)));
  return retryAfter > 0 ? { ok: false, retryAfter } : { ok: true };
}

export function tooMany(retryAfter: number, what = "Too many messages from your connection") {
  const minutes = Math.max(1, Math.ceil(retryAfter / 60));
  return Response.json(
    { error: `${what}. Please try again in ${minutes === 1 ? "a minute" : `${minutes} minutes`}.` },
    { status: 429, headers: { "retry-after": String(retryAfter) } },
  );
}

const MIN = 60;
const HOUR = 3600;
const DAY = 86_400;

// The limits, in one place. Generous for people, tight for scripts.
export const LIMITS = {
  // New chats: per visitor, and per team so a flood from many addresses can't
  // bury an inbox or spend the AI allowance.
  chatStart: (ip: string): Limit[] => [
    { key: `chat-start:ip:${ip}`, max: 5, windowSec: 10 * MIN },
    { key: `chat-start:ip-day:${ip}`, max: 20, windowSec: DAY },
  ],
  chatStartTeam: (orgId: string): Limit[] => [{ key: `chat-start:org:${orgId}`, max: 200, windowSec: HOUR }],
  chatReply: (ip: string, ticketId: string): Limit[] => [
    { key: `chat-reply:ticket:${ticketId}`, max: 30, windowSec: 5 * MIN },
    { key: `chat-reply:ip:${ip}`, max: 60, windowSec: 5 * MIN },
  ],
  // Files a visitor uploads, counted per file on top of the message limits.
  chatFiles: (ip: string, files: number): Limit[] => [{ key: `chat-files:ip:${ip}`, max: 20, windowSec: HOUR, cost: files }],
  // Satisfaction ratings from the links in reply emails.
  rate: (ip: string): Limit[] => [{ key: `rate:ip:${ip}`, max: 30, windowSec: 10 * MIN }],
  waitlist: (ip: string): Limit[] => [{ key: `waitlist:ip:${ip}`, max: 5, windowSec: HOUR }],
  // New chats naming one email address: stops the widget being used to make a
  // team's AI email someone over and over.
  chatTarget: (orgId: string, email: string): Limit[] => [{ key: `chat-start:to:${orgId}:${createHash("sha256").update(email).digest("hex").slice(0, 32)}`, max: 5, windowSec: DAY }],
  // Things a team sends from Flatdesk's own domain or pays for from its setup budget.
  testEmail: (orgId: string): Limit[] => [
    { key: `test-email:${orgId}`, max: 5, windowSec: HOUR },
    { key: `test-email-day:${orgId}`, max: 20, windowSec: DAY },
  ],
  invites: (orgId: string, count: number): Limit[] => [{ key: `invites:${orgId}`, max: 100, windowSec: DAY, cost: count }],
  tryAi: (orgId: string): Limit[] => [{ key: `try-ai:${orgId}`, max: 30, windowSec: HOUR }],
  testAlert: (orgId: string): Limit[] => [{ key: `test-alert:${orgId}`, max: 10, windowSec: HOUR }],
  // Test tickets email the admin's own address and run the AI, so not too many.
  testTickets: (orgId: string): Limit[] => [
    { key: `test-tickets:${orgId}`, max: 30, windowSec: HOUR },
    { key: `test-tickets-day:${orgId}`, max: 100, windowSec: DAY },
  ],
  // The REST API: per key, and new tickets per team, since each one can run the AI and send email.
  api: (keyId: string): Limit[] => [{ key: `api:key:${keyId}`, max: 1000, windowSec: HOUR }],
  apiNewTicket: (orgId: string): Limit[] => [{ key: `api:new-ticket:${orgId}`, max: 200, windowSec: HOUR }],
};
