// Ticket search, priority and who's viewing a ticket. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";

const ORG = "org_test_basics";
const OTHER = "org_test_basics_other";

after(async () => {
  const { pool } = await import("@/db");
  await pool.end();
});

async function fresh() {
  const { db, schema } = await import("@/db");
  for (const id of [ORG, OTHER]) {
    await db.delete(schema.orgs).where(eq(schema.orgs.id, id));
    await db.insert(schema.orgs).values({ id, name: id, aiEnabled: false });
  }
}

test("search finds tickets by number, subject, customer, tag and any message, only in the team", async () => {
  await fresh();
  const { createTicket, addReply } = await import("./tickets");
  const { searchTickets } = await import("./search");
  const a = await createTicket({ orgId: ORG, channel: "email", customerEmail: "kim@example.com", customerName: "Kim Lee", subject: "Order arrived damaged", body: "The box was crushed", authorType: "customer", tags: ["shipping"] });
  const b = await createTicket({ orgId: ORG, channel: "email", customerEmail: "pat@example.com", subject: "Invoice question", body: "Where is my invoice?", authorType: "customer" });
  await createTicket({ orgId: OTHER, channel: "email", customerEmail: "kim@example.com", subject: "Order arrived damaged", body: "crushed", authorType: "customer" });
  await addReply({ orgId: ORG, ticketId: b.id, userId: "user_x", body: "Customer wants a refund to their Visa", internal: true });

  const nums = async (q: string) => (await searchTickets(ORG, q)).map((t) => t.number).sort();
  assert.deepEqual(await nums(`#${a.number}`), [a.number]);
  assert.deepEqual(await nums("damaged"), [a.number]);
  assert.deepEqual(await nums("kim@example"), [a.number]);
  assert.deepEqual(await nums("Kim"), [a.number]);
  assert.deepEqual(await nums("shipping"), [a.number]);
  assert.deepEqual(await nums("crushed"), [a.number], "words in messages, never another team's");
  assert.deepEqual(await nums("visa"), [b.number], "internal notes are searchable by the team");
  assert.deepEqual(await nums("100%_"), [], "like wildcards are literal");
  assert.deepEqual(await nums('"invoice question" -refund'), [b.number], "subject match wins even with web-search syntax");
  assert.deepEqual(await nums(""), []);
});

test("priority: urgent and high sort first in open views; the API reads and sets it", async () => {
  await fresh();
  const { createTicket, listTickets, updateTicket } = await import("./tickets");
  const first = await createTicket({ orgId: ORG, channel: "email", customerEmail: "a@example.com", subject: "Old", body: "x", authorType: "customer" });
  const urgent = await createTicket({ orgId: ORG, channel: "email", customerEmail: "b@example.com", subject: "Site down", body: "x", authorType: "customer" });
  await updateTicket(ORG, urgent.id, { priority: "urgent" });
  const open = await listTickets(ORG, "user_x", "open");
  assert.deepEqual(open.map((t) => t.number), [urgent.number, first.number]);

  const { createApiKey } = await import("./api-keys");
  const made = await createApiKey(ORG, "user_x", "Script");
  assert.ok("key" in made);
  const route = await import("@/app/api/v1/tickets/[number]/route");
  const req = (body?: unknown) =>
    new Request(`http://x/api/v1/tickets/${first.number}`, { method: body ? "PATCH" : "GET", headers: { authorization: `Bearer ${made.key}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const params = { params: Promise.resolve({ number: String(first.number) }) } as never;
  assert.equal((await route.PATCH(req({ priority: "sky-high" }), params)).status, 400);
  assert.equal((await route.PATCH(req({ priority: "high" }), params)).status, 200);
  const got = await (await route.GET(req(), params)).json();
  assert.equal(got.ticket.priority, "high");
});

test("presence: others on the ticket and who is typing, never across teams", async () => {
  await fresh();
  const { createTicket, addReply } = await import("./tickets");
  const { reportPresence, leaveTicket } = await import("./presence");
  const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: "kim@example.com", subject: "Hi", body: "Hello", authorType: "customer" });
  assert.equal(await reportPresence(OTHER, "user_b", "Bo", t.id, false), null, "another team can't see or join it");

  const first = await reportPresence(ORG, "user_a", "Ana", t.id, false);
  assert.deepEqual(first?.others, []);
  await reportPresence(ORG, "user_b", "Bo", t.id, true);
  const again = await reportPresence(ORG, "user_a", "Ana", t.id, false);
  assert.deepEqual(again?.others, [{ name: "Bo", typing: true }]);

  const before = again?.latestMessageId;
  await addReply({ orgId: ORG, ticketId: t.id, userId: "user_b", body: "On it", internal: true });
  const later = await reportPresence(ORG, "user_a", "Ana", t.id, false);
  assert.notEqual(later?.latestMessageId, before, "a new message shows up for anyone on the ticket");

  await leaveTicket(ORG, "user_b", t.id);
  assert.deepEqual((await reportPresence(ORG, "user_a", "Ana", t.id, false))?.others, []);
});
