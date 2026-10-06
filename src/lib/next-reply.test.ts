// Next-reply targets and pausing the resolution clock while pending. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { nextReplyState, resolveState } from "./sla";

const created = new Date("2026-10-01T12:00:00Z");
const at = (m: number) => new Date(created.getTime() + m * 60_000);
const ORG = "org_next_reply_test";

test("next reply: due from the customer's latest message, only while open and after a first reply", () => {
  const org = { firstResponseMinutes: 60, businessHours: null, nextReplyMinutes: 120 };
  const t = { status: "open", createdAt: created, firstResponseAt: at(10), awaitingSince: at(100), closedAt: null, source: null, tags: [] as string[] };
  assert.deepEqual(nextReplyState(t, org, at(130)), { minutes: 120, tag: null, kind: "waiting", due: at(220), minutesLeft: 90, soon: false });
  assert.equal(nextReplyState(t, org, at(200))?.kind, "waiting");
  assert.equal((nextReplyState(t, org, at(200)) as { soon: boolean }).soon, true);
  assert.deepEqual(nextReplyState(t, org, at(250)), { minutes: 120, tag: null, kind: "overdue", due: at(220), minutesLate: 30 });
  assert.equal(nextReplyState({ ...t, awaitingSince: null }, org, at(250)), null, "nobody is waiting");
  assert.equal(nextReplyState({ ...t, firstResponseAt: null }, org, at(250)), null, "the first-reply target applies instead");
  assert.equal(nextReplyState({ ...t, status: "pending" }, org, at(250)), null);
  assert.equal(nextReplyState(t, { ...org, nextReplyMinutes: null }, at(250)), null);
  assert.equal(nextReplyState({ ...t, source: "zendesk" }, org, at(250)), null);
});

test("pause while pending: pending time is left out of the resolution clock", () => {
  const org = { firstResponseMinutes: 60, resolveMinutes: 1440, businessHours: null, slaPolicies: [], pauseWhilePending: true };
  const t = { status: "open", createdAt: created, firstResponseAt: at(10), closedAt: null, source: null, tags: [] as string[], pausedSeconds: 600 * 60, pendingSince: null };
  // Ten hours already spent pending push the due time back ten hours.
  assert.deepEqual(resolveState(t, org, at(60)), { minutes: 1440, tag: null, kind: "waiting", due: at(2040), minutesLeft: 1980, soon: false });
  assert.equal(resolveState(t, org, at(2000))?.kind, "waiting");
  assert.equal(resolveState(t, { ...org, pauseWhilePending: false }, at(2000))?.kind, "overdue", "off: pending time counts");
  // Pending right now: paused, and the current wait counts too.
  const pending = { ...t, status: "pending", pendingSince: at(1000) };
  const p = resolveState(pending, org, at(3000));
  assert.equal(p?.kind, "paused");
  assert.equal(p?.due.getTime(), at(2040 + 2000).getTime());
  // Closed: took leaves out the paused time.
  const closed = resolveState({ ...t, status: "closed", closedAt: at(1900) }, org);
  assert.equal(closed?.kind, "met");
  assert.equal(closed && "took" in closed ? closed.took : null, 1300);
});

test("database: triggers track pending time and who is waiting; late follow-ups are escalated once per wait", { skip: !process.env.DATABASE_URL }, async () => {
  const { db, schema } = await import("@/db");
  const { escalateOverdue, OVERDUE_TAG } = await import("./escalation");
  const { messages, tickets } = schema;

  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Next reply team", inboundKey: "nextr0001", businessHours: null, nextReplyMinutes: 60, pauseWhilePending: true });
  const [customer] = await db.insert(schema.customers).values({ orgId: ORG, email: "ana@x.com" }).returning();
  const now = new Date();
  const [t] = await db.insert(tickets).values({ orgId: ORG, number: 1, customerId: customer.id, subject: "Help", channel: "email", createdAt: now }).returning();
  const get = async () => (await db.query.tickets.findFirst({ where: eq(tickets.id, t.id) }))!;
  const say = (authorType: "customer" | "agent" | "ai", createdAt: Date, internal = false) => db.insert(messages).values({ orgId: ORG, ticketId: t.id, authorType, body: "x", internal, createdAt });

  // Before any reply, the first-reply target is the one that counts.
  await say("customer", now);
  assert.equal((await get()).awaitingSince, null);
  await db.update(tickets).set({ firstResponseAt: now }).where(eq(tickets.id, t.id));
  await say("agent", now);

  // Pending for a while, then back to open: the time is added up.
  await db.update(tickets).set({ status: "pending" }).where(eq(tickets.id, t.id));
  const pend = await get();
  assert.ok(pend.pendingSince);
  await db.update(tickets).set({ pendingSince: new Date(pend.pendingSince!.getTime() - 3600_000) }).where(eq(tickets.id, t.id));
  await db.update(tickets).set({ status: "open" }).where(eq(tickets.id, t.id));
  const back = await get();
  assert.equal(back.pendingSince, null);
  assert.ok(back.pausedSeconds >= 3600 && back.pausedSeconds < 3700, `paused ${back.pausedSeconds}`);

  // The customer writes back; a note doesn't count as an answer, a reply does.
  const wrote = new Date(now.getTime() + 60_000);
  await say("customer", wrote);
  assert.equal((await get()).awaitingSince?.getTime(), wrote.getTime());
  await say("customer", new Date(wrote.getTime() + 60_000));
  assert.equal((await get()).awaitingSince?.getTime(), wrote.getTime(), "kept from the first unanswered message");
  await say("agent", new Date(wrote.getTime() + 120_000), true);
  assert.ok((await get()).awaitingSince, "an internal note doesn't answer them");

  // Two hours later it's escalated, once.
  const late = new Date(wrote.getTime() + 2 * 3600_000);
  const r = await escalateOverdue(late);
  assert.ok(r.nextEscalated >= 1);
  const esc = await get();
  assert.equal(esc.nextEscalatedAt?.getTime(), late.getTime());
  assert.ok(esc.tags.includes(OVERDUE_TAG));
  assert.ok((await db.select().from(messages).where(eq(messages.ticketId, t.id))).some((m) => m.body.startsWith("Missed the next-reply target")));
  await escalateOverdue(new Date(late.getTime() + 600_000));
  assert.equal((await get()).nextEscalatedAt?.getTime(), late.getTime(), "once per wait");

  // Answered, then a new wait can be escalated again.
  await say("ai", new Date(late.getTime() + 60_000));
  assert.equal((await get()).awaitingSince, null);
  const again = new Date(late.getTime() + 120_000);
  await say("customer", again);
  const later = new Date(again.getTime() + 2 * 3600_000);
  await escalateOverdue(later);
  assert.equal((await get()).nextEscalatedAt?.getTime(), later.getTime());
});

after(async () => {
  if (!process.env.DATABASE_URL) return;
  const { db, schema, pool } = await import("@/db");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await pool.end();
});
