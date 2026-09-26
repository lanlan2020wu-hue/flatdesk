// AI receipts and refunds. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";

const ORG = "org_test_receipts";

after(async () => {
  const { pool } = await import("@/db");
  await pool.end();
});

test("refunding an included resolution stops it counting, moves overage inside the allowance and reopens the ticket", async () => {
  const { db, schema } = await import("@/db");
  const { createTicket } = await import("./tickets");
  const { monthKey } = await import("./ai");
  const { monthReceipt, refundResolution, receiptCsv, RefundError } = await import("./receipts");
  const { PLAN } = await import("./pricing");

  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Receipts team" });
  await db.insert(schema.agents).values({ orgId: ORG, userId: "u1", name: "Ana", email: "ana@acme.com", role: "admin" });

  const month = monthKey();
  const included = PLAN.includedPerAgent;
  // Fill the allowance, plus two overage resolutions and one answer the customer replied to.
  const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: "c@x.com", subject: "Reset password", body: "How?", authorType: "customer" });
  await db.update(schema.tickets).set({ status: "pending", resolvedByAi: true }).where(eq(schema.tickets.id, t.id));
  const base = Date.now() - 3_600_000;
  const rows = Array.from({ length: included + 2 }, (_, i) => ({
    orgId: ORG,
    ticketId: i === 0 ? t.id : null,
    kind: "resolution" as const,
    month,
    overage: i >= included,
    model: "test",
    sources: i === 0 ? ["Password reset"] : [],
    createdAt: new Date(base + i * 1000),
  }));
  const events = await db.insert(schema.aiEvents).values(rows).returning();
  await db.insert(schema.aiEvents).values({ orgId: ORG, kind: "handoff", month, model: "test" });

  let r = await monthReceipt(ORG, month);
  assert.equal(r.counted, included + 2);
  assert.equal(r.overage, 2);
  assert.equal(r.notCounted, 1);

  await refundResolution(ORG, events[0].id, { userId: "u1", name: "Ana" }, "Wrong link");
  r = await monthReceipt(ORG, month);
  assert.equal(r.counted, included + 1);
  assert.equal(r.overage, 1, "the earliest overage resolution moved inside the allowance");
  assert.equal(r.refunded, 1);
  const line = r.lines.find((l) => l.id === events[0].id)!;
  assert.equal(line.status, "refunded");
  assert.equal(line.refundNote, "Wrong link");
  assert.equal(line.refundedByName, "Ana");
  assert.deepEqual(line.sources, ["Password reset"]);

  const ticket = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, t.id) });
  assert.equal(ticket?.status, "open");
  assert.equal(ticket?.resolvedByAi, false);
  const notes = await db.select().from(schema.messages).where(eq(schema.messages.ticketId, t.id));
  assert.ok(notes.some((m) => m.internal && m.body.includes("Ana refunded the AI answer: Wrong link")));

  await assert.rejects(refundResolution(ORG, events[0].id, { userId: "u1", name: "Ana" }, ""), RefundError, "can't refund twice");

  // Once the month is billed, refunds close.
  await db.update(schema.orgs).set({ overageBilledMonth: month }).where(eq(schema.orgs.id, ORG));
  await assert.rejects(refundResolution(ORG, events[1].id, { userId: "u1", name: "Ana" }, ""), RefundError);

  const csv = receiptCsv(r);
  assert.match(csv.split("\n")[0], /^date,ticket,subject/);
  assert.equal(csv.trim().split("\n").length, r.lines.length + 1);

  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
});
