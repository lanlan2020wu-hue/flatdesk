// AI quality review. Model calls aren't made here; grading cleanup, the
// conversation a review reads, which replies wait, and the scorecards are.
// Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { QUALITY, cleanGrade, conversationBefore } from "./quality";

const grade = (overall: number, extra: Partial<{ issue: string; note: string }> = {}) => ({ overall, accuracy: overall, tone: 4, resolution: overall, issue: "", note: "Good.", ...extra });

test("the flag is decided from the score, not trusted from the model", () => {
  assert.equal(cleanGrade(grade(QUALITY.flagAt)).flagged, true);
  assert.equal(cleanGrade(grade(QUALITY.flagAt + 1, { issue: "Something" })).flagged, false);
  assert.equal(cleanGrade(grade(QUALITY.flagAt + 1, { issue: "Something" })).issue, null, "no issue on a reply that isn't flagged");
  assert.equal(cleanGrade(grade(1)).issue, "Scored low overall.", "a flagged reply always says why");
});

test("scores are clamped to 1 to 5", () => {
  const g = cleanGrade({ overall: 9, accuracy: 0, tone: 3.6, resolution: Number.NaN, issue: "", note: "  " });
  assert.deepEqual([g.overall, g.accuracy, g.tone, g.resolution], [5, 1, 4, 3]);
  assert.equal(g.note, "No notes.");
});

test("a review reads the conversation before the reply, with notes marked", () => {
  const thread = [
    { id: "a", authorType: "customer", internal: false, body: "Where is my refund?" },
    { id: "b", authorType: "agent", internal: true, body: "Refunds take 5 to 7 days." },
    { id: "c", authorType: "system", internal: true, body: "Assigned to Sam" },
    { id: "d", authorType: "agent", internal: false, body: "It'll be there tomorrow." },
    { id: "e", authorType: "customer", internal: false, body: "Thanks" },
  ];
  const c = conversationBefore(thread, "d")!;
  assert.equal(c.reply.id, "d");
  assert.match(c.before, /from="Customer"/);
  assert.match(c.before, /from="Internal team note"/);
  assert.ok(!c.before.includes("Assigned to Sam"), "system lines are left out");
  assert.ok(!c.before.includes("Thanks"), "nothing after the reply");
  assert.equal(conversationBefore(thread, "missing"), null);
});

test("a long conversation keeps the latest messages", () => {
  const thread = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, authorType: i % 2 ? "agent" : "customer", internal: false, body: `message ${i} ${"x".repeat(900)}` }));
  const c = conversationBefore(thread, "m29", 5000)!;
  assert.ok(c.before.length <= 5100);
  assert.match(c.before, /message 28 /);
  assert.match(c.before, /earlier messages left out/);
  assert.ok(!c.before.includes("message 2 "));
});

after(async () => {
  const { pool } = await import("@/db");
  await pool.end();
});

test("database: waiting replies, scorecards and the fair-use limit", { skip: !process.env.DATABASE_URL }, async () => {
  const { db, schema } = await import("@/db");
  const { createTicket } = await import("./tickets");
  const { pendingReplies, qualityRoom, qualitySummary, reviewsForMessages } = await import("./quality");
  const { aiUsage, monthKey } = await import("./ai");
  const ORG = "org_test_quality";

  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Quality team", billedSeats: 2, subscriptionStatus: "active" });
  await db.insert(schema.agents).values([
    { orgId: ORG, userId: "u1", name: "Ana Diaz", email: "ana@acme.com", role: "admin" },
    { orgId: ORG, userId: "u2", name: "Sam Lee", email: "sam@acme.com", role: "agent" },
  ]);

  const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: "kim@x.com", subject: "Refund", body: "Where is my refund?", authorType: "customer" });
  const old = new Date(Date.now() - (QUALITY.lookbackDays + 1) * 86_400_000);
  const [ana, sam, ai, note, stale] = await db
    .insert(schema.messages)
    .values([
      { orgId: ORG, ticketId: t.id, authorType: "agent", authorId: "u1", body: "Refunds take 5 to 7 days." },
      { orgId: ORG, ticketId: t.id, authorType: "agent", authorId: "u2", body: "It'll be there tomorrow." },
      { orgId: ORG, ticketId: t.id, authorType: "ai", body: "Refunds take 5 to 7 business days." },
      { orgId: ORG, ticketId: t.id, authorType: "agent", authorId: "u1", body: "Check with finance", internal: true },
      { orgId: ORG, ticketId: t.id, authorType: "agent", authorId: "u2", body: "Old reply", createdAt: old },
    ])
    .returning();

  const waiting = await pendingReplies(ORG, 50);
  assert.deepEqual(new Set(waiting), new Set([ana.id, sam.id, ai.id]), "customer messages, internal notes and old replies aren't reviewed");
  assert.ok(!waiting.includes(note.id) && !waiting.includes(stale.id));

  const month = monthKey();
  const row = (m: typeof ana, overall: number) => ({
    orgId: ORG, ticketId: t.id, messageId: m.id, authorType: m.authorType, authorId: m.authorType === "agent" ? m.authorId : null, month, ...cleanGrade(grade(overall, { issue: "Promised a date the policy doesn't allow." })), model: "test",
  });
  await db.insert(schema.replyReviews).values([row(ana, 5), row(sam, 2), row(ai, 4)]);

  assert.deepEqual(await pendingReplies(ORG, 50), [], "reviewed replies stop waiting");
  const q = await qualitySummary(ORG, 30);
  assert.equal(q.reviewed, 3);
  assert.equal(q.flagged, 1);
  assert.ok(Math.abs(q.average! - 11 / 3) < 1e-9);
  assert.deepEqual(q.cards.map((c) => c.name).sort(), ["AI answers", "Ana Diaz", "Sam Lee"]);
  assert.equal(q.flaggedReplies[0].author, "Sam Lee");
  assert.equal(q.flaggedReplies[0].issue, "Promised a date the policy doesn't allow.");

  const byMessage = await reviewsForMessages(ORG, [ana.id, sam.id, note.id]);
  assert.equal(byMessage.get(sam.id)?.flagged, true);
  assert.equal(byMessage.has(note.id), false);

  assert.deepEqual(await qualityRoom(ORG), { used: 3, limit: 2 * QUALITY.perAgent, locked: false }, "paid seats set the limit");
  assert.equal((await aiUsage(ORG)).used, 0, "reviews never use AI resolutions");

  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
});
