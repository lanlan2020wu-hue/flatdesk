// Multi-turn AI answers, viewer seats and duplicate inbound email.
// The model is a small fake server. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";

process.env.INBOUND_DOMAIN = "in.flatdesk.test";
process.env.EMAIL_FROM = "support@mail.flatdesk.test";
process.env.ANTHROPIC_API_KEY = "test-key";

const ORG = "org_test_followups";
type Turn = { role: string; content: string };
const requests: Turn[][] = [];

// Answers unless the latest customer message asks for a person.
const fake = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const { messages } = JSON.parse(body) as { messages: Turn[] };
    requests.push(messages);
    const last = messages[messages.length - 1].content;
    const out = /person/i.test(last)
      ? { decision: "handoff", reply: "", reason: "Asked for a person.", sources: [] }
      : { decision: "answer", reply: `Answer ${messages.length}`, reason: "Covered.", sources: ["Password reset"] };
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: JSON.stringify(out) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
    );
  });
});

before(async () => {
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
});

after(async () => {
  fake.close();
  const { pool } = await import("@/db");
  await pool.end();
});

async function setup() {
  const { db, schema } = await import("@/db");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Follow-up team", inboundKey: "futest0001" });
  await db.insert(schema.agents).values({ orgId: ORG, userId: "u1", name: "Ana", email: "ana@acme.com", role: "admin" });
  await db.insert(schema.macros).values({ orgId: ORG, name: "Password reset", body: "Use the reset link." });
  return { db, schema };
}

test("the AI answers follow-ups on its own ticket, counted once, and hands off when asked or out of turns", async () => {
  const { db, schema } = await setup();
  const { answerNewTicket, answerFollowUp, MAX_FOLLOW_UPS } = await import("./ai");
  const { createTicket, addCustomerMessage } = await import("./tickets");
  const events = () => db.select().from(schema.aiEvents).where(eq(schema.aiEvents.orgId, ORG));
  const ticketOf = (id: string) => db.query.tickets.findFirst({ where: eq(schema.tickets.id, id) });

  const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: "c@x.com", subject: "Reset", body: "How do I reset my password?", authorType: "customer" });
  await answerNewTicket(ORG, t.id);
  assert.equal((await ticketOf(t.id))?.resolvedByAi, true);

  for (let i = 1; i <= MAX_FOLLOW_UPS; i++) {
    await addCustomerMessage({ orgId: ORG, ticketId: t.id, customerId: t.customerId, body: `Still stuck ${i}` });
    await answerFollowUp(ORG, t.id);
    const now = await ticketOf(t.id);
    assert.equal(now?.status, "pending", `follow-up ${i} answered`);
    assert.equal(now?.resolvedByAi, true);
  }
  // The model saw the whole conversation, with its own replies as assistant turns and no footer.
  const turns = requests[requests.length - 1];
  assert.deepEqual(turns.map((m) => m.role), ["user", "assistant", "user", "assistant", "user", "assistant", "user"]);
  assert.equal(turns[1].content, "Answer 1");
  let e = await events();
  assert.equal(e.filter((x) => x.kind === "resolution").length, 1, "one ticket, one resolution");
  assert.equal(e.filter((x) => x.kind === "followup").length, MAX_FOLLOW_UPS);

  // Out of follow-ups: the next message goes to the team and un-counts the ticket.
  await addCustomerMessage({ orgId: ORG, ticketId: t.id, customerId: t.customerId, body: "One more" });
  await answerFollowUp(ORG, t.id);
  assert.equal((await ticketOf(t.id))?.resolvedByAi, false);
  e = await events();
  assert.equal(e.filter((x) => x.kind === "resolution").length, 0);

  // Asking for a person hands off straight away.
  const u = await createTicket({ orgId: ORG, channel: "email", customerEmail: "d@x.com", subject: "Reset", body: "Password help?", authorType: "customer" });
  await answerNewTicket(ORG, u.id);
  await addCustomerMessage({ orgId: ORG, ticketId: u.id, customerId: u.customerId, body: "Can I talk to a person?" });
  await answerFollowUp(ORG, u.id);
  const handed = await ticketOf(u.id);
  assert.equal(handed?.resolvedByAi, false);
  assert.equal(handed?.status, "open");
  const aiReplies = await db.$count(schema.messages, and(eq(schema.messages.ticketId, u.id), eq(schema.messages.authorType, "ai")));
  assert.equal(aiReplies, 1);
});

test("viewers aren't billed seats", async () => {
  const { db, schema } = await setup();
  const { seatCount } = await import("./billing");
  await db.insert(schema.agents).values([
    { orgId: ORG, userId: "u2", name: "Bo", email: "bo@acme.com", role: "agent" },
    { orgId: ORG, userId: "u3", name: "Cy", email: "cy@acme.com", role: "agent", viewer: true },
  ]);
  assert.equal(await seatCount(ORG), 2);
});

test("the same email delivered twice at once makes one message", async () => {
  const { db, schema } = await setup();
  await db.update(schema.orgs).set({ aiEnabled: false }).where(eq(schema.orgs.id, ORG));
  const { handleInboundEmail } = await import("./inbound");
  const mail = { from: "C <c@x.com>", to: ["futest0001@in.flatdesk.test"], subject: "Hi", text: "Hello", headers: null, messageId: "<dup@x.com>" };
  const results = await Promise.all([handleInboundEmail(mail), handleInboundEmail(mail)]);
  assert.equal(await db.$count(schema.messages, eq(schema.messages.orgId, ORG)), 1);
  assert.ok(results.some((r) => "ignored" in r && r.ignored === "duplicate"));
});
