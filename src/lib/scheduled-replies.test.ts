// Send later. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { parseSendAt, ScheduleError, SCHEDULE } from "./scheduled-replies";

const ORG = "org_test_send_later";

test("a send time must be at least a minute ahead and within the limit", () => {
  const now = new Date("2026-10-09T10:00:00Z");
  assert.equal(parseSendAt("2026-10-09T11:00:00.000Z", now).toISOString(), "2026-10-09T11:00:00.000Z");
  assert.throws(() => parseSendAt("2026-10-09T10:00:30Z", now), ScheduleError);
  assert.throws(() => parseSendAt("2026-10-09T09:00:00Z", now), ScheduleError);
  assert.throws(() => parseSendAt(new Date(now.getTime() + (SCHEDULE.maxDays + 1) * 86_400_000).toISOString(), now), ScheduleError);
  assert.throws(() => parseSendAt("soon", now), ScheduleError);
  assert.throws(() => parseSendAt("", now), ScheduleError);
});

if (process.env.DATABASE_URL) {
  after(async () => {
    const { db, schema, pool } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await pool.end();
  });

  test("database: due replies go out, and wait for a person when the customer wrote again", async () => {
    const { db, schema } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await db.insert(schema.orgs).values({ id: ORG, name: "Acme" });
    await db.insert(schema.agents).values({ orgId: ORG, userId: "user_ada", name: "Ada", email: "ada@acme.test", role: "admin", signature: "Ada at Acme" });
    const { createTicket } = await import("./tickets");
    const { cancelScheduled, scheduleReply, sendDueReplies, sendScheduled, waitingOn } = await import("./scheduled-replies");
    const mk = (subject: string) => createTicket({ orgId: ORG, channel: "email", customerEmail: `${subject.toLowerCase()}@example.com`, customerName: subject, subject, body: "Help", authorType: "customer" });
    const soon = new Date(Date.now() + 120_000);

    const a = await mk("Refund");
    const b = await mk("Shipping");
    const c = await mk("Login");
    const ra = await scheduleReply({ orgId: ORG, ticketId: a.id, userId: "user_ada", body: "Refund is on its way.", nextStatus: "closed", addTags: ["refund"], sendAt: soon });
    const rb = await scheduleReply({ orgId: ORG, ticketId: b.id, userId: "user_ada", body: "Shipped today.", nextStatus: "pending", sendAt: soon });
    const rc = await scheduleReply({ orgId: ORG, ticketId: c.id, userId: "user_ada", body: "Try a reset.", nextStatus: "pending", sendAt: new Date(Date.now() + 86_400_000) });
    await assert.rejects(scheduleReply({ orgId: ORG, ticketId: a.id, userId: "user_ada", body: "  ", nextStatus: "pending", sendAt: soon }), ScheduleError);

    // The customer on ticket b writes again before it's due.
    await new Promise((r) => setTimeout(r, 20));
    await db.insert(schema.messages).values({ orgId: ORG, ticketId: b.id, authorType: "customer", body: "Actually, change the address?" });

    // Nothing is due yet.
    assert.deepEqual(await sendDueReplies(new Date()), { sent: 0, held: 0 });
    const out = await sendDueReplies(new Date(Date.now() + 180_000));
    assert.deepEqual(out, { sent: 1, held: 1 });

    const ticketA = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, a.id) });
    assert.equal(ticketA?.status, "closed");
    assert.ok(ticketA?.tags.includes("refund"));
    const sentA = (await db.select().from(schema.messages).where(eq(schema.messages.ticketId, a.id))).find((m) => m.authorType === "agent");
    assert.equal(sentA?.body, "Refund is on its way.\n\nAda at Acme", "sent with the writer's signature");
    assert.equal((await db.query.scheduledReplies.findFirst({ where: eq(schema.scheduledReplies.id, ra.id) }))?.messageId, sentA?.id);

    const heldB = await db.query.scheduledReplies.findFirst({ where: eq(schema.scheduledReplies.id, rb.id) });
    assert.equal(heldB?.status, "held");
    assert.match(heldB?.heldReason ?? "", /customer wrote again/);
    assert.equal((await waitingOn(ORG, b.id)).length, 1, "a held reply still shows on the ticket");
    // A person looks and sends it anyway.
    assert.deepEqual((await sendScheduled(ORG, rb.id, { now: true })).sent, true);
    assert.equal((await sendScheduled(ORG, rb.id, { now: true })).sent, false, "never twice");

    // Cancelling hands the text back; a cancelled reply never sends.
    assert.equal((await cancelScheduled(ORG, rc.id))?.body, "Try a reset.");
    assert.equal((await sendScheduled(ORG, rc.id, { now: true })).sent, false);
    assert.equal((await waitingOn(ORG, c.id)).length, 0);

    // A ticket can't pile up scheduled replies.
    for (let i = 0; i < SCHEDULE.perTicket; i++) await scheduleReply({ orgId: ORG, ticketId: c.id, userId: "user_ada", body: `Note ${i}`, nextStatus: "pending", sendAt: soon });
    await assert.rejects(scheduleReply({ orgId: ORG, ticketId: c.id, userId: "user_ada", body: "One more", nextStatus: "pending", sendAt: soon }), ScheduleError);
  });
}
