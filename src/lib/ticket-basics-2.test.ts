// CC on email tickets, merging tickets, @mentions in notes and reply
// signatures. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { and, asc, eq } from "drizzle-orm";

process.env.INBOUND_DOMAIN = "in.flatdesk.test";
const ORG = "org_test_basics2";
const KEY = "basics2key01";

after(async () => {
  const { pool } = await import("@/db");
  await pool.end();
});

async function fresh() {
  const { db, schema } = await import("@/db");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Acme", aiEnabled: false, inboundKey: KEY, supportEmail: "help@acme.test" });
  await db.insert(schema.agents).values([
    { orgId: ORG, userId: "user_ada", name: "Ada Lovelace", email: "ada@acme.test", role: "admin", signature: "Ada\nAcme support" },
    { orgId: ORG, userId: "user_sam", name: "Sam Ortiz", email: "sortiz@acme.test", role: "agent" },
  ]);
}

const mail = (o: Partial<{ from: string; to: string[]; copied: string[]; subject: string; text: string; messageId: string }>) => ({
  from: o.from ?? "Kim <kim@example.com>",
  to: o.to ?? [`${KEY}@in.flatdesk.test`],
  copied: o.copied,
  subject: o.subject ?? "Order problem",
  text: o.text ?? "Hello",
  headers: null,
  messageId: o.messageId ?? `<${Math.random()}@example.com>`,
});

test("CC: copied people come from To and Cc, never the team or Flatdesk, and can reply to the ticket", async () => {
  await fresh();
  const { ccFromEmail, parseCcList } = await import("./cc");
  assert.deepEqual(
    ccFromEmail(["help@acme.test", `${KEY}@in.flatdesk.test`, "Kim <kim@example.com>", "Pat <pat@example.com>", "billing@acme.test", "pat@example.com"], { customer: "kim@example.com", supportEmail: "help@acme.test" }),
    ["pat@example.com"],
  );
  assert.deepEqual(parseCcList("a@x.com, b@y.com; a@x.com kim@example.com", "kim@example.com"), ["a@x.com", "b@y.com"]);
  assert.ok("error" in (parseCcList("nope", "kim@example.com") as object));

  const { db, schema } = await import("@/db");
  const { handleInboundEmail } = await import("./inbound");
  const made = await handleInboundEmail(mail({ copied: ["help@acme.test", "Pat <pat@example.com>"] }));
  const [t] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, made.ticketId!));
  assert.deepEqual(t.cc, ["pat@example.com"]);

  // Pat replies: it lands on the same ticket, under Pat's name.
  const reply = await handleInboundEmail(mail({ from: "Pat <pat@example.com>", to: [`${KEY}+${t.number}@in.flatdesk.test`], text: "Same problem here" }));
  assert.equal(reply.action, "appended");
  assert.equal(reply.ticketId, t.id);
  // A stranger doesn't.
  const stranger = await handleInboundEmail(mail({ from: "eve@evil.test", to: [`${KEY}+${t.number}@in.flatdesk.test`], text: "Let me in" }));
  assert.equal(stranger.action, "created");
});

test("merge: messages move, the merged ticket closes and points at the target, and its mail follows", async () => {
  await fresh();
  const { db, schema } = await import("@/db");
  const { createTicket } = await import("./tickets");
  const { mergeTickets } = await import("./merge");
  const { handleInboundEmail } = await import("./inbound");
  const a = await createTicket({ orgId: ORG, channel: "email", customerEmail: "kim@example.com", subject: "Broken", body: "First", authorType: "customer", tags: ["bug"] });
  const b = await createTicket({ orgId: ORG, channel: "email", customerEmail: "pat@example.com", subject: "Broken too", body: "Second", authorType: "customer", tags: ["urgent-ish"] });

  assert.deepEqual(await mergeTickets(ORG, a.id, a.number, "Ada"), { error: "A ticket can't be merged into itself." });
  assert.deepEqual(await mergeTickets(ORG, b.id, 999999, "Ada"), { error: "There's no ticket #999999." });
  assert.deepEqual(await mergeTickets(ORG, b.id, a.number, "Ada"), { number: a.number });

  const [from] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, b.id));
  const [into] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, a.id));
  assert.equal(from.status, "closed");
  assert.equal(from.mergedIntoId, a.id);
  assert.deepEqual(into.tags.sort(), ["bug", "urgent-ish"]);
  assert.deepEqual(into.cc, ["pat@example.com"], "the other customer is copied");
  const bodies = (await db.select().from(schema.messages).where(eq(schema.messages.ticketId, a.id)).orderBy(asc(schema.messages.createdAt))).filter((m) => m.authorType === "customer").map((m) => m.body);
  assert.deepEqual(bodies, ["First", "Second"]);
  assert.deepEqual(await mergeTickets(ORG, b.id, a.number, "Ada"), { error: "This ticket was already merged." });

  // Pat replies to the old ticket's address: it lands on the merged-into ticket.
  const r = await handleInboundEmail(mail({ from: "pat@example.com", to: [`${KEY}+${b.number}@in.flatdesk.test`], text: "Any news?" }));
  assert.equal(r.ticketId, a.id);
});

test("mentions match first names, full names and email names; signatures go under replies only", async () => {
  await fresh();
  const { findMentions } = await import("./mentions");
  const team = [
    { userId: "a", name: "Ada Lovelace", email: "ada@acme.test" },
    { userId: "s", name: "Sam Ortiz", email: "sortiz@acme.test" },
  ];
  const ids = (b: string) => findMentions(b, team).map((x) => x.userId).sort();
  assert.deepEqual(ids("@sam can you look?"), ["s"]);
  assert.deepEqual(ids("cc @Ada Lovelace and @sortiz"), ["a", "s"]);
  assert.deepEqual(ids("email me at kim@sam.com"), [], "an email address isn't a mention");
  assert.deepEqual(ids("@nobody"), []);

  const { db, schema } = await import("@/db");
  const { addReply, createTicket } = await import("./tickets");
  const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: "kim@example.com", subject: "Hi", body: "Hi", authorType: "customer" });
  const r1 = await addReply({ orgId: ORG, ticketId: t.id, userId: "user_ada", body: "Sorted, thanks!", internal: false });
  const r2 = await addReply({ orgId: ORG, ticketId: t.id, userId: "user_ada", body: "note to self", internal: true });
  const [m1] = await db.select().from(schema.messages).where(and(eq(schema.messages.id, r1.messageId!)));
  const [m2] = await db.select().from(schema.messages).where(and(eq(schema.messages.id, r2.messageId!)));
  assert.equal(m1.body, "Sorted, thanks!\n\nAda\nAcme support");
  assert.equal(m2.body, "note to self");
});
