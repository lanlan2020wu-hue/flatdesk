// Test tickets: who can be the customer, and that they never count or bill. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { allowedCustomerEmail, parseTestForm, TestTicketError } from "./test-tickets";

const ORG = "org_test_tickets";

test("the customer of a test ticket is always the admin's own address", () => {
  assert.equal(allowedCustomerEmail("Ana@Acme.com", "ana@acme.com"), "ana@acme.com");
  assert.equal(allowedCustomerEmail("ana@acme.com", "ANA+refund@acme.com"), "ana+refund@acme.com");
  assert.equal(allowedCustomerEmail("ana@acme.com", "anab@acme.com"), null);
  assert.equal(allowedCustomerEmail("ana@acme.com", "ana@acme.co"), null);
  assert.equal(allowedCustomerEmail("ana@acme.com", "bob@example.com"), null);
  assert.equal(allowedCustomerEmail("", "ana@acme.com"), null);

  const form = new FormData();
  form.set("email", "someone@else.com");
  form.set("subject", "Hi");
  form.set("body", "Hello");
  assert.throws(() => parseTestForm(form, "ana@acme.com"), TestTicketError);

  const preset = new FormData();
  preset.set("scenario", "upset");
  preset.set("age", "3h");
  const p = parseTestForm(preset, "ana@acme.com");
  assert.equal(p.channel, "chat");
  assert.equal(p.email, "ana+upset@acme.com");
  assert.equal(p.ageMinutes, 180);
});

test("database: test tickets follow rules, stay out of the allowance and bill, and clear in one go", { skip: !process.env.DATABASE_URL }, async () => {
  const { db, schema, pool } = await import("@/db");
  after(() => pool.end());
  const { aiUsage, monthKey, reserveSlot, CALL_RESERVE_USD, TEST_AI_BUDGET_USD } = await import("./ai");
  const { createTestTicket, clearTestTickets, customerWritesBack, listTestTickets, parseTestForm } = await import("./test-tickets");
  const { createTicket } = await import("./tickets");
  const { teamReport } = await import("./reports");

  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Test tickets team", inboundKey: "tttest0001" });
  await db.insert(schema.agents).values([
    { orgId: ORG, userId: "u1", name: "Ana", email: "ana@acme.com", role: "admin" },
    { orgId: ORG, userId: "u2", name: "Ben", email: "ben@acme.com", role: "agent" },
  ]);
  await db.insert(schema.rules).values({ orgId: ORG, ifTag: "invoices", assignTo: "u2" });

  // "Tagged for a rule" picks up the team's own rule and is assigned by it.
  const form = new FormData();
  form.set("scenario", "routed");
  form.set("age", "1d");
  const t = await createTestTicket(ORG, parseTestForm(form, "ana@acme.com"), "routed");
  assert.equal(t.test, true);
  assert.deepEqual(t.tags, ["invoices"]);
  assert.equal(t.assigneeId, "u2");
  const stored = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, t.id) });
  assert.ok(stored && Date.now() - stored.createdAt.getTime() > 23 * 3600_000, "backdated to see the reply target");

  // The AI on a test ticket never touches the allowance.
  const before = await aiUsage(ORG);
  const slot = await reserveSlot(ORG, t.id);
  assert.ok("eventId" in slot);
  await db.update(schema.aiEvents).set({ kind: "resolution" }).where(eq(schema.aiEvents.id, slot.eventId));
  const afterUsage = await aiUsage(ORG);
  assert.equal(afterUsage.used, before.used);
  assert.equal(afterUsage.attempts, before.attempts);
  assert.equal(afterUsage.spentUsd, before.spentUsd);
  const ev = await db.query.aiEvents.findFirst({ where: eq(schema.aiEvents.id, slot.eventId) });
  assert.equal(ev?.test, true);
  assert.equal(ev?.overage, false);

  // A real ticket still counts.
  const real = await createTicket({ orgId: ORG, channel: "email", customerEmail: "c@x.com", subject: "Real", body: "Hi", authorType: "customer" });
  const realSlot = await reserveSlot(ORG, real.id);
  assert.ok("eventId" in realSlot);
  assert.equal((await aiUsage(ORG)).attempts, before.attempts + 1);

  // Reports leave test tickets out.
  const report = await teamReport(ORG, 7);
  assert.equal(report.created, 1);

  // The test budget pauses the AI on test tickets only.
  await db.update(schema.aiEvents).set({ costUsd: String(TEST_AI_BUDGET_USD) }).where(eq(schema.aiEvents.id, slot.eventId));
  const t2 = await createTestTicket(ORG, parseTestForm(form, "ana@acme.com"), "routed");
  const paused = await reserveSlot(ORG, t2.id);
  assert.ok("paused" in paused && /test tickets/i.test(paused.paused));
  assert.ok(CALL_RESERVE_USD > 0);

  await customerWritesBack(ORG, t.number, "Still wrong.");
  await assert.rejects(customerWritesBack(ORG, real.number, "Not a test"), /gone/);
  const rows = await listTestTickets(ORG);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.number === t.number)?.messages, 2);

  assert.equal(await clearTestTickets(ORG), 2);
  assert.equal(await db.$count(schema.tickets, and(eq(schema.tickets.orgId, ORG), eq(schema.tickets.test, true))), 0);
  assert.equal(await db.$count(schema.tickets, eq(schema.tickets.orgId, ORG)), 1, "the real ticket stays");
  // The spend stays, so clearing doesn't reset the test budget.
  const kept = await db.$count(schema.aiEvents, and(eq(schema.aiEvents.orgId, ORG), eq(schema.aiEvents.test, true), eq(schema.aiEvents.month, monthKey())));
  assert.equal(kept, 1);
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
});
