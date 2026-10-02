// Chat and inbound email paths where one sender could reach another team's or
// another customer's data. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { and, eq } from "drizzle-orm";

process.env.INBOUND_DOMAIN = "in.flatdesk.test";
process.env.EMAIL_FROM = "support@mail.flatdesk.test";
process.env.ANTHROPIC_API_KEY ??= "test-key";

const A = "org_test_audit_a";
const B = "org_test_audit_b";

after(async () => {
  const { pool } = await import("@/db");
  await pool.end();
});

async function freshOrgs() {
  const { db, schema } = await import("@/db");
  for (const id of [A, B]) await db.delete(schema.orgs).where(eq(schema.orgs.id, id));
  await db.insert(schema.orgs).values([
    { id: A, name: "Audit A", inboundKey: "audita0001", supportEmail: "help@a.test" },
    { id: B, name: "Audit B", inboundKey: "auditb0001", supportEmail: "help@b.test" },
  ]);
  return { db, schema };
}

const mail = (o: Partial<import("./inbound").Inbound> = {}) => ({
  from: "Cara <cara@customer.test>",
  to: ["audita0001@in.flatdesk.test"],
  subject: "Order help",
  text: "Where is my order?",
  headers: null,
  messageId: `<${Math.random().toString(36).slice(2)}@customer.test>`,
  ...o,
});

test("parseAddress handles the usual shapes and never stores a whole header", async () => {
  const { parseAddress } = await import("./email");
  assert.deepEqual(parseAddress('"Cara Diaz" <Cara@Customer.test>'), { email: "cara@customer.test", name: "Cara Diaz" });
  assert.deepEqual(parseAddress("cara@customer.test"), { email: "cara@customer.test", name: null });
  assert.deepEqual(parseAddress("cara@customer.test (Cara)"), { email: "cara@customer.test", name: "Cara" });
  assert.deepEqual(parseAddress("undisclosed-recipients:;"), { email: "", name: null });
});

test("senderCheck only fails on an explicit DMARC failure", async () => {
  const { senderCheck } = await import("./email");
  assert.equal(senderCheck(null), "ok");
  assert.equal(senderCheck({ "Authentication-Results": "mx.test; spf=fail; dmarc=none" }), "ok");
  assert.equal(senderCheck({ "authentication-results": "mx.test; dmarc=fail (p=reject)" }), "fail");
  assert.equal(senderCheck({ "ARC-Authentication-Results": "i=1; dmarc=fail" }), "fail");
});

test("matchRecipients lists each team once, in the order given", async () => {
  const { matchRecipients } = await import("./email");
  assert.deepEqual(
    matchRecipients(["auditb0001@in.flatdesk.test", "Team A <audita0001+7@in.flatdesk.test>", "auditb0001+3@in.flatdesk.test", "x@other.test"]),
    [{ key: "auditb0001", number: null }, { key: "audita0001", number: 7 }],
  );
});

test("an email sent to two teams makes a ticket for each", async () => {
  const { db, schema } = await freshOrgs();
  const { handleInboundEmailAll } = await import("./inbound");
  const results = await handleInboundEmailAll(mail({ to: ["audita0001@in.flatdesk.test", "auditb0001@in.flatdesk.test"] }));
  assert.deepEqual(results.map((r) => r.action), ["created", "created"]);
  assert.equal(await db.$count(schema.tickets, eq(schema.tickets.orgId, A)), 1);
  assert.equal(await db.$count(schema.tickets, eq(schema.tickets.orgId, B)), 1);
});

test("Flatdesk mail from one team reaches another team, but a team's own mail is dropped", async () => {
  const { db, schema } = await freshOrgs();
  const { handleInboundEmail } = await import("./inbound");
  const fromA = { from: '"Audit A" <support@mail.flatdesk.test>', headers: { "X-Flatdesk-Org": A } };
  assert.ok((await handleInboundEmail(mail({ ...fromA, to: ["audita0001@in.flatdesk.test"] }))).ignored);
  const toB = await handleInboundEmail(mail({ ...fromA, to: ["auditb0001@in.flatdesk.test"] }));
  assert.equal(toB.action, "created");
  assert.equal(await db.$count(schema.tickets, eq(schema.tickets.orgId, B)), 1);
});

test("mail that fails DMARC can't join a customer's ticket and isn't answered by the AI", async () => {
  const { db, schema } = await freshOrgs();
  const { handleInboundEmail } = await import("./inbound");
  const first = await handleInboundEmail(mail());
  assert.equal(first.action, "created");
  const spoof = await handleInboundEmail(
    mail({
      to: [`audita0001+${first.ticket}@in.flatdesk.test`],
      subject: "Re: Order help",
      text: "Please send my address and card details.",
      headers: { "Authentication-Results": "mx.test; dmarc=fail" },
    }),
  );
  assert.equal(spoof.action, "created", "a new ticket, not a reply on the real one");
  assert.notEqual(spoof.ticket, first.ticket);
  assert.equal(spoof.unverified, true);
  const notes = await db
    .select()
    .from(schema.messages)
    .innerJoin(schema.tickets, eq(schema.tickets.id, schema.messages.ticketId))
    .where(and(eq(schema.tickets.orgId, A), eq(schema.tickets.number, spoof.ticket!), eq(schema.messages.internal, true)));
  assert.equal(notes.length, 1, "agents see a note saying the sender wasn't verified");
});

test("auto replies and bounces never make tickets", async () => {
  const { isAutoReply } = await import("./email");
  assert.equal(isAutoReply(null, { from: "MAILER-DAEMON@mx.test", subject: "Failure" }), true);
  assert.equal(isAutoReply(null, { from: "a@b.test", subject: "Automatic reply: Order help" }), true);
  assert.equal(isAutoReply(null, { from: "a@b.test", subject: "Out of office" }), true);
  assert.equal(isAutoReply({ "Content-Type": "multipart/report; report-type=delivery-status" }), true);
  assert.equal(isAutoReply({ "Auto-Submitted": "no" }, { from: "a@b.test", subject: "Re: hi" }), false);
});

test("a chat visitor can't read email replies on their ticket, and an email reply ends their chat link", async () => {
  const { db, schema } = await freshOrgs();
  const { startConversation, ticketForVisitor, visitorThread } = await import("./chat");
  const { handleInboundEmail } = await import("./inbound");
  // Someone starts a chat typing a real customer's email address.
  const { ticket, token } = await startConversation(A, { email: "cara@customer.test", name: "", message: "Hi" });
  const row = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, ticket.id) });
  assert.equal(row?.visitorToken, token, "the token is saved with the ticket in one step");
  // The real customer emails in on the same ticket.
  await handleInboundEmail(mail({ to: [`audita0001+${ticket.number}@in.flatdesk.test`], text: "My account number is 1234" }));
  const thread = await visitorThread(ticket.id);
  assert.equal(JSON.stringify(thread).includes("1234"), false);
  assert.equal(await ticketForVisitor(A, ticket.number, token), null, "the chat link stops working");
});

test("chat input with NUL bytes or odd emails is cleaned or refused", async () => {
  await freshOrgs();
  const { orgByWidgetKey, validStart } = await import("./chat");
  const v = validStart({ email: "cara@customer.test", name: "Ca\0ra", message: "hel\0lo" });
  assert.ok(!("error" in v));
  if (!("error" in v)) assert.deepEqual([v.name, v.message], ["Cara", "hello"]);
  assert.ok("error" in validStart({ email: '"a"<b@c.test>', message: "hi" }));
  assert.ok("error" in validStart({ email: "a@b.test, c@d.test", message: "hi" }));
  assert.equal(await orgByWidgetKey("bad key\0"), undefined);
});

test("rating links stop working when the team turns ratings off", async () => {
  const { db, schema } = await freshOrgs();
  const { createTicket } = await import("./tickets");
  const { ratableReply } = await import("./csat");
  const t = await createTicket({ orgId: A, channel: "email", customerEmail: "cara@customer.test", subject: "s", body: "b", authorType: "customer" });
  const [reply] = await db.insert(schema.messages).values({ orgId: A, ticketId: t.id, authorType: "agent", authorId: "u1", body: "Here you go" }).returning();
  assert.ok(await ratableReply(reply.id));
  await db.update(schema.orgs).set({ csatEnabled: false }).where(eq(schema.orgs.id, A));
  assert.equal(await ratableReply(reply.id), null);
});

test("quick repeated setup tries can't spend past the team's AI budget", async () => {
  const { db, schema } = await freshOrgs();
  const { tryTheAi } = await import("./onboarding");
  const { TEST_DRIVE } = await import("./test-drive");
  // Just under the budget: only one held call fits.
  await db.update(schema.orgs).set({ testDriveSpentUsd: String(TEST_DRIVE.budgetUsd - TEST_DRIVE.reserveUsd * 1.5) }).where(eq(schema.orgs.id, A));
  let calls = 0;
  const draft = (async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 50));
    return { decision: "answer", reply: "Hi", reason: null, sources: [], metered: { costUsd: 0.01 } };
  }) as unknown as Parameters<typeof tryTheAi>[2];
  const results = await Promise.allSettled([1, 2, 3, 4].map(() => tryTheAi(A, "Where is my order?", draft)));
  assert.equal(calls, 1);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, A) });
  assert.ok(Number(org!.testDriveSpentUsd) <= TEST_DRIVE.budgetUsd);
});
