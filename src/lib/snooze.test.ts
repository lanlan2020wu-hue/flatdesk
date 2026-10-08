// Snoozed tickets. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { parseSnoozeUntil } from "./snooze";

process.env.INBOUND_DOMAIN = "in.flatdesk.test";
const ORG = "org_test_snooze";
const KEY = "snoozekey001";

test("a snooze time is at least a minute ahead and at most a year", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  assert.equal(parseSnoozeUntil("2026-10-09T09:00:00.000Z", now)?.toISOString(), "2026-10-09T09:00:00.000Z");
  assert.equal(parseSnoozeUntil("2026-10-08T12:00:30Z", now), null);
  assert.equal(parseSnoozeUntil("2026-10-07T12:00:00Z", now), null);
  assert.equal(parseSnoozeUntil("2028-01-01T00:00:00Z", now), null);
  assert.equal(parseSnoozeUntil("tomorrow", now), null);
  assert.equal(parseSnoozeUntil(null, now), null);
});

if (process.env.DATABASE_URL) {
  after(async () => {
    const { db, schema, pool } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await pool.end();
  });

  const mail = (from: string, subject = "Hello", extra = {}) => ({ from, to: [`${KEY}@in.flatdesk.test`], subject, text: "Body text", headers: null, messageId: `<${Math.random()}@example.com>`, ...extra });

  test("database: a snoozed ticket leaves the working views, then comes back to Open", async () => {
    const { db, schema } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await db.insert(schema.orgs).values({ id: ORG, name: "Acme", aiEnabled: false, inboundKey: KEY });
    await db.insert(schema.agents).values({ orgId: ORG, userId: "user_ada", name: "Ada", email: "ada@acme.test", role: "admin" });
    const { handleInboundEmail } = await import("./inbound");
    const { listTickets, viewCounts } = await import("./tickets");
    const { snoozeTicket, unsnoozeTicket, wakeSnoozed } = await import("./snooze");

    const a = await handleInboundEmail(mail("kim@example.com", "Invoice"));
    const b = await handleInboundEmail(mail("lee@example.com", "Shipping"));
    assert.equal((await viewCounts(ORG, "user_ada")).snoozed, null, "no tab while nothing is snoozed");

    const later = new Date(Date.now() + 86_400_000);
    assert.ok(await snoozeTicket(ORG, a.ticketId!, later, "Ada"));
    assert.deepEqual((await listTickets(ORG, "user_ada", "open")).map((t) => t.id), [b.ticketId]);
    assert.deepEqual((await listTickets(ORG, "user_ada", "snoozed")).map((t) => t.id), [a.ticketId]);
    const counts = await viewCounts(ORG, "user_ada");
    assert.equal(counts.open, 1);
    assert.equal(counts.snoozed, 1);

    // Not due yet: the wake-up job leaves it.
    assert.equal(await wakeSnoozed(new Date(), ORG), 0);
    // Due: back in Open with a note, and the snooze is gone.
    assert.equal(await wakeSnoozed(new Date(later.getTime() + 1000), ORG), 1);
    const woke = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, a.ticketId!) });
    assert.equal(woke?.snoozedUntil, null);
    assert.equal(woke?.status, "open");
    assert.equal((await listTickets(ORG, "user_ada", "open")).length, 2);
    const notes = await db.select({ body: schema.messages.body }).from(schema.messages).where(and(eq(schema.messages.ticketId, a.ticketId!), eq(schema.messages.authorType, "system")));
    assert.ok(notes.some((n) => n.body.startsWith("Snoozed by Ada until")));
    assert.ok(notes.some((n) => n.body === "Snooze ended. Back in Open."));

    // A pending ticket snoozed as a follow-up reminder comes back as Open.
    await db.update(schema.tickets).set({ status: "pending" }).where(eq(schema.tickets.id, b.ticketId!));
    await snoozeTicket(ORG, b.ticketId!, later, "Ada");
    assert.equal((await listTickets(ORG, "user_ada", "pending")).length, 0);
    await wakeSnoozed(new Date(later.getTime() + 1000), ORG);
    assert.equal((await db.query.tickets.findFirst({ where: eq(schema.tickets.id, b.ticketId!) }))?.status, "open");

    // Woken early from the ticket page.
    await snoozeTicket(ORG, a.ticketId!, later, "Ada");
    assert.ok(await unsnoozeTicket(ORG, a.ticketId!, "Ada"));
    assert.equal(await unsnoozeTicket(ORG, a.ticketId!, "Ada"), false, "already awake");
  });

  test("database: the customer writing back wakes a snoozed ticket", async () => {
    const { db, schema } = await import("@/db");
    const { handleInboundEmail } = await import("./inbound");
    const { snoozeTicket } = await import("./snooze");
    const r = await handleInboundEmail(mail("max@example.com", "Order"));
    await snoozeTicket(ORG, r.ticketId!, new Date(Date.now() + 86_400_000), "Ada");
    const msg = await db.query.messages.findFirst({ where: and(eq(schema.messages.ticketId, r.ticketId!), eq(schema.messages.authorType, "customer")) });
    const reply = await handleInboundEmail(mail("max@example.com", "Re: Order", { headers: { "In-Reply-To": msg!.emailMessageId! } }));
    assert.equal(reply.action, "appended");
    const t = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, r.ticketId!) });
    assert.equal(t?.snoozedUntil, null);
    assert.equal(t?.status, "open");
  });
}
