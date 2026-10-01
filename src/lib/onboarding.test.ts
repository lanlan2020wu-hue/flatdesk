// Onboarding pieces that ride on inbound email. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { and, eq } from "drizzle-orm";

process.env.INBOUND_DOMAIN = "in.flatdesk.test";
process.env.EMAIL_FROM = "support@mail.flatdesk.test";

const ORG = "org_test_onboarding";

after(async () => {
  const { pool } = await import("@/db");
  await pool.end();
});

test("Gmail's forwarding confirmation is shown in onboarding, and the test email becomes a test ticket", async () => {
  // Imported after the env is set: email config is read when the module loads.
  const { db, schema } = await import("@/db");
  const { handleInboundEmail } = await import("./inbound");
  const { getOnboarding, TEST_TAG, updateOnboarding } = await import("./onboarding");

  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Onboarding team", inboundKey: "obtest0001", supportEmail: "help@acme.com" });
  await db.insert(schema.agents).values({ orgId: ORG, userId: "u1", name: "Ana", email: "ana@acme.com", role: "admin" });

  const confirm = await handleInboundEmail({
    from: "Gmail Team <forwarding-noreply@google.com>",
    to: ["obtest0001@in.flatdesk.test"],
    subject: "(#123456789) Gmail Forwarding Confirmation - Receive Mail from help@acme.com",
    text: "Confirmation code: 123456789\n\nTo allow help@acme.com to automatically forward mail, click:\nhttps://mail-settings.google.com/mail/vf-abc123\n",
    headers: null,
    messageId: "<confirm@google.com>",
  });
  assert.deepEqual(confirm, { ignored: "gmail forwarding confirmation" });
  let o = await getOnboarding(ORG);
  assert.equal(o.ob.gmailConfirmation?.code, "123456789");
  assert.equal(o.ob.gmailConfirmation?.link, "https://mail-settings.google.com/mail/vf-abc123");
  assert.equal(await db.$count(schema.tickets, eq(schema.tickets.orgId, ORG)), 0, "no ticket for the confirmation");

  // The test email comes from Flatdesk's own address, which is normally ignored.
  await updateOnboarding(ORG, (ob) => ({ ...ob, testToken: "ft-abc123", testSentAt: new Date().toISOString() }));
  const result = await handleInboundEmail({
    from: "Flatdesk <support@mail.flatdesk.test>",
    to: ["obtest0001@in.flatdesk.test"],
    subject: "Fwd: Flatdesk test [ft-abc123]",
    text: "This is a test from Flatdesk.",
    headers: null,
    messageId: "<test@flatdesk>",
  });
  assert.equal(result.action, "created");
  assert.equal("orgId" in result, false, "no AI answer for the test ticket");
  const ticket = await db.query.tickets.findFirst({ where: and(eq(schema.tickets.orgId, ORG), eq(schema.tickets.number, result.ticket!)) });
  assert.deepEqual(ticket?.tags, [TEST_TAG]);

  o = await getOnboarding(ORG);
  assert.equal(o.testEmailArrived, true);
  assert.deepEqual(
    o.steps.filter((s) => s.done).map((s) => s.id),
    ["team", "inbox", "test"],
  );
  assert.equal(o.ob.testToken, undefined, "a retried delivery doesn't make a second ticket");
});

test("setup shows the AI answering before anything else is connected, and a sample ticket doesn't finish setup", async () => {
  process.env.ANTHROPIC_API_KEY ||= "test-key";
  const { db, schema } = await import("@/db");
  const { getOnboarding, tryTheAi, TEST_TAG } = await import("./onboarding");
  const { createTicket } = await import("./tickets");
  const ORG2 = "org_test_onboarding_ai";
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG2));
  await db.insert(schema.orgs).values({ id: ORG2, name: "Fresh team", inboundKey: "obtest0002", aiInstructions: "We ship within 2 days." });
  await db.insert(schema.agents).values({ orgId: ORG2, userId: "u1", name: "Ana", email: "ana@acme.com", role: "admin" });

  let o = await getOnboarding(ORG2);
  assert.deepEqual(o.steps.map((s) => s.id), ["team", "ai", "inbox", "invite", "import", "test"]);
  assert.deepEqual(o.steps.filter((s) => s.done).map((s) => s.id), ["team"]);

  // Hand-offs don't finish the step; the AI has to actually answer.
  const metered = { model: "test", inputTokens: 100, outputTokens: 50, costUsd: "0.03000" };
  const handoff = await tryTheAi(ORG2, "Can I get a refund?", async () => ({ decision: "handoff", reply: "", reason: "Refunds go to the team.", sources: [], metered }));
  assert.equal(handoff.decision, "handoff");
  o = await getOnboarding(ORG2);
  assert.equal(o.steps.find((s) => s.id === "ai")?.done, false);

  let seen: { body: string } | null = null;
  const answer = await tryTheAi(ORG2, "How long does shipping take?", async (_org, _kb, msg) => {
    seen = msg;
    return { decision: "answer", reply: "Within 2 days.", reason: "Notes cover it.", sources: [], metered };
  });
  assert.equal(answer.reply, "Within 2 days.");
  assert.equal(seen!.body, "How long does shipping take?");
  o = await getOnboarding(ORG2);
  assert.equal(o.steps.find((s) => s.id === "ai")?.done, true);
  assert.equal(Number(o.org.testDriveSpentUsd), 0.06, "both tries are paid from the test drive budget");

  // A sample ticket is for looking around; a chat from the widget connects the team and proves it works.
  await createTicket({ orgId: ORG2, channel: "email", customerEmail: "sam.sample@example.com", subject: "Sample", body: "Hi", authorType: "customer", tags: [TEST_TAG] });
  o = await getOnboarding(ORG2);
  assert.deepEqual(o.steps.filter((s) => s.done).map((s) => s.id), ["team", "ai"]);
  await createTicket({ orgId: ORG2, channel: "chat", customerEmail: "visitor@x.com", subject: "Chat", body: "Hello", authorType: "customer" });
  o = await getOnboarding(ORG2);
  assert.deepEqual(o.steps.filter((s) => s.done).map((s) => s.id), ["team", "ai", "inbox", "test"]);
});
