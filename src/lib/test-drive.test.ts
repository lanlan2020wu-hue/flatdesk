// AI test drive. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import type { Draft } from "./ai";

const ORG = "org_test_drive";

after(async () => {
  const { pool } = await import("@/db");
  await pool.end();
});

// Stands in for the model: answers when the question mentions "password", hands off otherwise.
const fakeDraft = (cost = "0.04000") => async (_org: unknown, _kb: unknown, msg: { body: string }): Promise<Draft> => {
  const metered = { model: "test", inputTokens: 100, outputTokens: 50, costUsd: cost };
  return /password/i.test(msg.body)
    ? { decision: "answer", reply: "Use the reset link on the sign-in page.", reason: "Covered by a macro.", sources: ["Password reset"], metered }
    : { decision: "handoff", reply: "", reason: "Needs the account.", sources: [], metered };
};

async function setup() {
  process.env.ANTHROPIC_API_KEY ||= "test-key";
  const { db, schema } = await import("@/db");
  const { createTicket, addReply } = await import("./tickets");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Test drive team" });
  await db.insert(schema.agents).values({ orgId: ORG, userId: "u1", name: "Ana", email: "ana@acme.com", role: "admin" });
  await db.insert(schema.macros).values({ orgId: ORG, name: "Password reset", body: "Use the reset link." });

  const answered = [];
  for (let i = 0; i < 4; i++) {
    const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: `c${i}@x.com`, subject: `Q${i}`, body: i % 2 ? "Where is my order?" : "How do I reset my password?", authorType: "customer" });
    await addReply({ orgId: ORG, ticketId: t.id, userId: "u1", body: `Team answer ${i}`, internal: false });
    answered.push(t);
  }
  // Not eligible: no team reply yet, and one the AI already answered.
  await createTicket({ orgId: ORG, channel: "email", customerEmail: "n@x.com", subject: "Unanswered", body: "Hello?", authorType: "customer" });
  const ai = await createTicket({ orgId: ORG, channel: "email", customerEmail: "a@x.com", subject: "AI one", body: "password?", authorType: "customer" });
  await db.insert(schema.messages).values({ orgId: ORG, ticketId: ai.id, authorType: "ai", body: "AI reply" });
  await addReply({ orgId: ORG, ticketId: ai.id, userId: "u1", body: "Follow-up", internal: false });
  return { db, schema, answered };
}

test("drafts recent answered tickets beside the team's reply, without touching the AI allowance", async () => {
  const { db, schema, answered } = await setup();
  const { startTestDrive, runTestDriveStep, testDriveDrafts, scorecard, rateDraft, spentUsd, TEST_DRIVE } = await import("./test-drive");

  assert.equal(await startTestDrive(ORG), 4, "only tickets a person answered and the AI never touched");
  let p = await runTestDriveStep(ORG, fakeDraft());
  assert.equal(p.done, TEST_DRIVE.perStep);
  while (!p.finished) p = await runTestDriveStep(ORG, fakeDraft());
  assert.equal(p.done, 4);

  const rows = await testDriveDrafts(ORG);
  assert.deepEqual(new Set(rows.map((r) => r.ticketNumber)), new Set(answered.map((t) => t.number)));
  const pw = rows.find((r) => r.decision === "answer")!;
  assert.equal(pw.draft, "Use the reset link on the sign-in page.");
  assert.deepEqual(pw.sources, ["Password reset"]);
  assert.match(pw.teamReply!, /^Team answer/);
  assert.equal(pw.teamReplyBy, "Ana");
  assert.equal(pw.question, "How do I reset my password?");

  await rateDraft(ORG, pw.id, "send", "u1");
  const score = scorecard(await testDriveDrafts(ORG));
  assert.deepEqual([score.answered, score.handedOff, score.rated, score.send], [2, 2, 1, 1]);

  assert.equal((await spentUsd(ORG)).toFixed(2), "0.16");
  const events = await db.select().from(schema.aiEvents).where(eq(schema.aiEvents.orgId, ORG));
  assert.equal(events.length, 0, "no AI events, so no allowance used and nothing on receipts");
  const sent = await db.select().from(schema.messages).where(eq(schema.messages.orgId, ORG));
  assert.ok(!sent.some((m) => m.body.includes("reset link on the sign-in")), "drafts never become messages");
});

test("stops at the budget and skips the rest", async () => {
  await setup();
  const { db, schema } = await import("@/db");
  const { startTestDrive, runTestDriveStep, TEST_DRIVE, TestDriveError } = await import("./test-drive");

  await db.update(schema.orgs).set({ testDriveSpentUsd: String(TEST_DRIVE.budgetUsd - 0.1) }).where(eq(schema.orgs.id, ORG));
  await startTestDrive(ORG);
  let p = await runTestDriveStep(ORG, fakeDraft("0.30000"));
  assert.equal(p.done, 1, "only one call fits in what's left of the budget");
  while (!p.finished) p = await runTestDriveStep(ORG, fakeDraft("0.30000"));
  assert.equal(p.skipped, 3);
  assert.ok(p.spentUsd >= TEST_DRIVE.budgetUsd);
  await assert.rejects(startTestDrive(ORG), TestDriveError);
});

test("a failed call leaves the ticket marked failed and costs nothing", async () => {
  await setup();
  const { startTestDrive, runTestDriveStep, spentUsd } = await import("./test-drive");
  await startTestDrive(ORG);
  let p = await runTestDriveStep(ORG, async () => {
    throw new Error("timeout");
  });
  while (!p.finished) p = await runTestDriveStep(ORG, async () => {
    throw new Error("timeout");
  });
  assert.equal(p.failed, 4);
  assert.equal(await spentUsd(ORG), 0);
});
