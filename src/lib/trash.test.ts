// Ticket trash and blocked senders. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { isBlocked, normalizeBlockEntry, parseBlockList } from "./trash";

process.env.INBOUND_DOMAIN = "in.flatdesk.test";
const ORG = "org_test_trash";
const KEY = "trashkey0001";

test("blocklist entries: whole addresses or a domain, lowercase", () => {
  assert.equal(normalizeBlockEntry(" Spam@Example.com "), "spam@example.com");
  assert.equal(normalizeBlockEntry("@Example.com"), "@example.com");
  assert.equal(normalizeBlockEntry("example.com"), "@example.com");
  assert.equal(normalizeBlockEntry("mailto:a@b.io"), "a@b.io");
  assert.equal(normalizeBlockEntry("not an address"), null);
  assert.equal(normalizeBlockEntry("@localhost"), null);
  assert.equal(normalizeBlockEntry("a b@example.com"), null);
  assert.deepEqual(parseBlockList("a@x.com\n@y.com, junk words; A@X.com"), { list: ["a@x.com", "@y.com"], rejected: ["junk words"] });
});

test("blocked: the address, or anyone at the domain and its subdomains", () => {
  const list = ["spam@example.com", "@pushy.io"];
  assert.ok(isBlocked(list, "SPAM@example.com"));
  assert.ok(!isBlocked(list, "kim@example.com"));
  assert.ok(isBlocked(list, "sales@pushy.io"));
  assert.ok(isBlocked(list, "bot@mail.pushy.io"));
  assert.ok(!isBlocked(list, "me@notpushy.io"));
  assert.ok(!isBlocked([], "anyone@example.com"));
});

if (process.env.DATABASE_URL) {
  after(async () => {
    const { pool } = await import("@/db");
    await pool.end();
  });

  const mail = (from: string, subject = "Hello", messageId = `<${Math.random()}@example.com>`) => ({
    from,
    to: [`${KEY}@in.flatdesk.test`],
    subject,
    text: "Body text",
    headers: null,
    messageId,
  });

  async function fresh(blockedSenders: string[] = []) {
    const { db, schema } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await db.insert(schema.orgs).values({ id: ORG, name: "Acme", aiEnabled: false, inboundKey: KEY, blockedSenders });
    await db.insert(schema.agents).values({ orgId: ORG, userId: "user_ada", name: "Ada", email: "ada@acme.test", role: "admin" });
  }

  test("database: email from a blocked sender goes straight to the trash, out of every view", async () => {
    await fresh(["@pushy.io"]);
    const { db, schema } = await import("@/db");
    const { handleInboundEmail } = await import("./inbound");
    const { listTickets, viewCounts } = await import("./tickets");
    const { searchTickets } = await import("./search");
    const r = await handleInboundEmail(mail("Rep <rep@pushy.io>", "Quick question about your SEO"));
    assert.equal(r.blocked, true);
    // No org/ticket id, so the webhook route runs no AI answer, routing or alert for it.
    assert.equal(r.orgId, undefined);
    assert.equal(r.ticketId, undefined);
    const t = await db.query.tickets.findFirst({ where: and(eq(schema.tickets.orgId, ORG), eq(schema.tickets.number, r.ticket!)) });
    assert.ok(t?.deletedAt);
    assert.equal(t.status, "closed");
    assert.equal((await listTickets(ORG, "user_ada", "open")).length, 0);
    assert.equal((await listTickets(ORG, "user_ada", "closed")).length, 0);
    assert.equal((await listTickets(ORG, "user_ada", "trash")).length, 1);
    assert.equal((await viewCounts(ORG, "user_ada")).open, 0);
    assert.equal((await searchTickets(ORG, "SEO")).length, 0);
    // A second email from them doesn't join the trashed ticket; it's trashed on its own.
    const again = await handleInboundEmail(mail("rep@pushy.io", "Re: Quick question about your SEO"));
    assert.equal(again.blocked, true);
    assert.equal((await listTickets(ORG, "user_ada", "trash")).length, 2);
    // Everyone else still gets through.
    const kim = await handleInboundEmail(mail("kim@example.com"));
    assert.equal(kim.action, "created");
    assert.ok(!kim.blocked);
    assert.equal((await listTickets(ORG, "user_ada", "open")).length, 1);
  });

  test("database: delete and restore keep the ticket's status; a customer reply brings it back", async () => {
    await fresh();
    const { db, schema } = await import("@/db");
    const { handleInboundEmail } = await import("./inbound");
    const { listTickets } = await import("./tickets");
    const { restoreTickets, trashTickets } = await import("./trash");
    const r = await handleInboundEmail(mail("kim@example.com", "Order"));
    const id = r.ticketId!;
    await db.update(schema.tickets).set({ status: "pending" }).where(eq(schema.tickets.id, id));
    assert.equal(await trashTickets(ORG, [id], "Ada"), 1);
    assert.equal(await trashTickets(ORG, [id], "Ada"), 0, "already in the trash");
    assert.equal((await listTickets(ORG, "user_ada", "pending")).length, 0);
    assert.equal(await restoreTickets(ORG, [id], "Ada"), 1);
    const back = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, id) });
    assert.equal(back?.status, "pending");
    assert.equal(back?.deletedAt, null);
    const notes = await db.select({ body: schema.messages.body }).from(schema.messages).where(and(eq(schema.messages.ticketId, id), eq(schema.messages.authorType, "system")));
    assert.ok(notes.some((n) => n.body.startsWith("Moved to the trash by Ada")));
    assert.ok(notes.some((n) => n.body === "Restored from the trash by Ada."));

    // Trashed, then the customer writes back on the same thread: it's open again.
    await trashTickets(ORG, [id], "Ada");
    const msg = await db.query.messages.findFirst({ where: and(eq(schema.messages.ticketId, id), eq(schema.messages.authorType, "customer")) });
    const reply = await handleInboundEmail({ ...mail("kim@example.com", "Re: Order"), headers: { "In-Reply-To": msg!.emailMessageId! } });
    assert.equal(reply.action, "appended");
    const reopened = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, id) });
    assert.equal(reopened?.status, "open");
    assert.equal(reopened?.deletedAt, null);
  });

  test("database: blocking a sender keeps one copy of each entry; the trash empties after 30 days", async () => {
    await fresh();
    const { db, schema } = await import("@/db");
    const { handleInboundEmail } = await import("./inbound");
    const { blockSender, purgeTrash, trashTickets, TRASH_DAYS } = await import("./trash");
    assert.equal(await blockSender(ORG, "Rep@Pushy.io"), "rep@pushy.io");
    assert.equal(await blockSender(ORG, "rep@pushy.io"), "rep@pushy.io");
    assert.equal(await blockSender(ORG, "nonsense"), null);
    const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, ORG) });
    assert.deepEqual(org?.blockedSenders, ["rep@pushy.io"]);

    const old = await handleInboundEmail(mail("a@example.com"));
    const recent = await handleInboundEmail(mail("b@example.com"));
    await trashTickets(ORG, [old.ticketId!, recent.ticketId!], "Ada");
    await db.update(schema.tickets).set({ deletedAt: new Date(Date.now() - (TRASH_DAYS + 1) * 86_400_000) }).where(eq(schema.tickets.id, old.ticketId!));
    assert.equal(await purgeTrash(new Date(), ORG), 1);
    assert.equal(await db.query.tickets.findFirst({ where: eq(schema.tickets.id, old.ticketId!) }), undefined);
    assert.ok(await db.query.tickets.findFirst({ where: eq(schema.tickets.id, recent.ticketId!) }));
  });
}
