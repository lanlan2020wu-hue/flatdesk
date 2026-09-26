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
