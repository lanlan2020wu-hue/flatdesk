// The agent copilot. Model calls aren't made here; the limit, the summary
// cache and the thread the copilot reads are. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { COPILOT, parseSummary, threadText } from "./copilot";

const msg = (i: number, authorType: string, body: string, internal = false) => ({ id: `m${i}`, authorType, internal, body, name: authorType === "customer" ? "Kim" : "Ana" });

test("the copilot reads the thread with who said what, notes marked as team-only", () => {
  const text = threadText([msg(0, "customer", "Where is my order?"), msg(1, "agent", "Checking with the warehouse.", true), msg(2, "ai", "It ships Monday.")]);
  assert.match(text, /from="Customer \(Kim\)"/);
  assert.match(text, /Internal note from Ana \(team only\)/);
  assert.match(text, /AI assistant, sent to the customer/);
});

test("a long thread keeps the first message and the latest, and says what it left out", () => {
  const thread = Array.from({ length: 40 }, (_, i) => msg(i, i % 2 ? "agent" : "customer", `message ${i} ${"x".repeat(900)}`));
  const text = threadText(thread, 10_000);
  assert.ok(text.length <= 10_200);
  assert.match(text, /message 0 /);
  assert.match(text, /message 39 /);
  assert.match(text, /earlier messages left out/);
  assert.ok(!text.includes("message 5 "));
});

test("a stored summary that doesn't parse is ignored", () => {
  assert.equal(parseSummary("not json"), null);
  assert.equal(parseSummary(JSON.stringify({ points: "x" })), null);
  assert.deepEqual(parseSummary(JSON.stringify({ points: ["a"], mood: "calm", next: "Reply", at: "t" }))?.points, ["a"]);
});

after(async () => {
  const { pool } = await import("@/db");
  await pool.end();
});

test("database: the fair-use limit follows seats, and a summary is reused until someone writes again", { skip: !process.env.DATABASE_URL }, async () => {
  const { db, schema } = await import("@/db");
  const { createTicket, addReply } = await import("./tickets");
  const { cachedSummary, copilotUsage, copilotBreakdown, summarizeTicket } = await import("./copilot");
  const { monthKey } = await import("./ai");
  const ORG = "org_test_copilot";

  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Copilot team", billedSeats: 3, subscriptionStatus: "active" });
  await db.insert(schema.agents).values([
    { orgId: ORG, userId: "u1", name: "Ana Diaz", email: "ana@acme.com", role: "admin" },
    { orgId: ORG, userId: "u2", name: "Sam", email: "sam@acme.com", role: "agent", viewer: true },
  ]);
  assert.deepEqual(await copilotUsage(ORG), { used: 0, limit: 3 * COPILOT.perAgent, month: monthKey() }, "paid seats set the limit");

  const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: "kim@x.com", subject: "Order late", body: "Where is my order?", authorType: "customer" });
  const [first] = await db.select().from(schema.messages).where(eq(schema.messages.ticketId, t.id));
  const saved = { points: ["Kim's order is late"], mood: "frustrated" as const, next: "Check tracking", at: new Date().toISOString() };
  await db.insert(schema.copilotEvents).values({ orgId: ORG, ticketId: t.id, userId: "u1", kind: "summary", month: monthKey(), lastMessageId: first.id, output: JSON.stringify(saved), model: "test" });

  // Nothing new since: the stored summary comes back without a model call (none is configured here).
  const key = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.deepEqual(await summarizeTicket(ORG, "u1", t.id), saved);
    assert.equal((await cachedSummary(ORG, t.id, first.id))?.stale, false);
    await addReply({ orgId: ORG, ticketId: t.id, userId: "u1", body: "Looking into it.", internal: false });
    const [, reply] = await db.select().from(schema.messages).where(eq(schema.messages.ticketId, t.id)).orderBy(schema.messages.createdAt);
    assert.equal((await cachedSummary(ORG, t.id, reply.id))?.stale, true, "a new message makes it stale");
    await assert.rejects(summarizeTicket(ORG, "u1", t.id), /isn't set up/, "a fresh summary needs the AI");
  } finally {
    if (key) process.env.ANTHROPIC_API_KEY = key;
  }

  assert.deepEqual(await copilotBreakdown(ORG), { summary: 1, draft: 0, rewrite: 0, translate: 0 });
  // Copilot actions never touch the AI allowance.
  assert.equal((await db.select().from(schema.aiEvents).where(eq(schema.aiEvents.orgId, ORG))).length, 0);
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
});
