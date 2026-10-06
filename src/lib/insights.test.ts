// AI insights: what the model reads, the refresh limit, and the live numbers
// per topic. Model calls aren't made here. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { INSIGHTS, insightPrompt, nextRunAt } from "./insights";

test("the model reads each ticket's subject, first message, tags and what happened, numbered", () => {
  const text = insightPrompt([
    { id: "a", number: 1, subject: "Where is my order", first: "It's been 2 weeks", tags: ["shipping"], outcome: "handoff", reason: "No tracking info in the knowledge." },
    { id: "b", number: 2, subject: "Refund", first: "Please refund", tags: [], outcome: "ai", reason: null },
  ]);
  assert.match(text, /^\[1\] Where is my order\nIt's been 2 weeks\ntags: shipping\noutcome: AI handed it to the team: No tracking info/);
  assert.match(text, /\[2\] Refund\nPlease refund\noutcome: AI answered it/);
});

test("insights refresh at most every few hours", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  assert.equal(nextRunAt(null, now), null);
  assert.ok(nextRunAt({ createdAt: new Date(now.getTime() - 3600_000) }, now));
  assert.equal(nextRunAt({ createdAt: new Date(now.getTime() - (INSIGHTS.everyHours + 1) * 3600_000) }, now), null);
});

after(async () => {
  const { pool } = await import("@/db");
  await pool.end();
});

test("database: topics show live counts from their tickets, never another team's", { skip: !process.env.DATABASE_URL }, async () => {
  const ORG = "org_test_insights";
  const OTHER = "org_test_insights_other";
  const { db, schema } = await import("@/db");
  const { createTicket, updateTicket } = await import("./tickets");
  const { insightTickets, runInsights, topicStats } = await import("./insights");
  for (const id of [ORG, OTHER]) {
    await db.delete(schema.orgs).where(eq(schema.orgs.id, id));
    await db.insert(schema.orgs).values({ id, name: id, aiEnabled: false });
  }
  const make = (orgId: string, subject: string) => createTicket({ orgId, channel: "email", customerEmail: "kim@x.com", subject, body: `${subject}, please help`, authorType: "customer" });
  const a = await make(ORG, "Where is my order");
  const b = await make(ORG, "Order still not here");
  const c = await make(ORG, "Refund please");
  const theirs = await make(OTHER, "Not yours");
  await db.update(schema.tickets).set({ resolvedByAi: true, status: "pending" }).where(eq(schema.tickets.id, a.id));
  await updateTicket(ORG, c.id, { status: "closed" });
  await createTicket({ orgId: ORG, channel: "email", customerEmail: "t@x.com", subject: "Test", body: "test", authorType: "customer", test: true });

  const list = await insightTickets(ORG, 30);
  assert.deepEqual(list.map((t) => t.number).sort(), [a.number, b.number, c.number], "test tickets and other teams are left out");
  assert.equal(list.find((t) => t.id === a.id)?.outcome, "ai");

  const stats = await topicStats(ORG, [
    { name: "Where is my order", summary: "", ticketIds: [a.id, b.id, theirs.id], gap: "", suggestion: "" },
    { name: "Refunds", summary: "", ticketIds: [c.id], gap: "", suggestion: "" },
  ]);
  assert.deepEqual(stats.map((s) => [s.name, s.count, s.ai, s.open]), [["Where is my order", 2, 1, 2], ["Refunds", 1, 0, 0]]);

  const key = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await assert.rejects(runInsights(ORG, "u1", 30), /isn't set up/);
  } finally {
    if (key) process.env.ANTHROPIC_API_KEY = key;
  }
});
