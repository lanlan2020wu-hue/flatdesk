// Triggers and escalation. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { toTrigger } from "./import/sources/zendesk";
import { conditionMatches, runTimedTriggers, runTriggers, triggerFromForm, type TriggerTicket } from "./triggers";

const ticket: TriggerTicket = { channel: "email", subject: "Refund please", body: "I was charged twice for March.", from: "ana@bigfirm.com", tags: [] };
const trig = (over: object) => ({ name: "t", enabled: true, matchAll: true, conditions: [], actions: [], ...over });

test("conditions: any of the words, case-insensitive; excludes; channel", () => {
  assert.ok(conditionMatches({ field: "subject", op: "includes", value: "REFUND, money back" }, ticket));
  assert.ok(!conditionMatches({ field: "body", op: "includes", value: "refund" }, ticket));
  assert.ok(conditionMatches({ field: "subject_or_body", op: "includes", value: "charged twice" }, ticket));
  assert.ok(conditionMatches({ field: "from", op: "includes", value: "@bigfirm.com" }, ticket));
  assert.ok(conditionMatches({ field: "from", op: "excludes", value: "@gmail.com" }, ticket));
  assert.ok(conditionMatches({ field: "channel", op: "is", value: "email" }, ticket));
  assert.ok(!conditionMatches({ field: "channel", op: "is_not", value: "email" }, ticket));
  assert.ok(!conditionMatches({ field: "tags", op: "includes", value: "vip" }, ticket));
});

test("triggers run in order and see tags earlier ones added", () => {
  const list = [
    trig({ name: "Billing", conditions: [{ field: "subject_or_body", op: "includes", value: "refund, charged" }], actions: [{ type: "add_tags", tags: ["billing"] }] }),
    trig({ name: "Billing to Sam", conditions: [{ field: "tags", op: "includes", value: "billing" }], actions: [{ type: "assign", to: "sam" }, { type: "note", body: "Check Stripe." }] }),
    trig({ name: "Off", enabled: false, conditions: [{ field: "channel", op: "is", value: "email" }], actions: [{ type: "set_status", status: "closed" }] }),
    trig({ name: "Any", matchAll: false, conditions: [{ field: "subject", op: "includes", value: "nope" }, { field: "from", op: "includes", value: "bigfirm" }], actions: [{ type: "set_status", status: "pending" }, { type: "assign", to: "gone" }] }),
  ];
  const r = runTriggers(list, ticket, (id) => id === "sam");
  assert.deepEqual(r.fired, ["Billing", "Billing to Sam", "Any"]);
  assert.deepEqual(r.tags, ["billing"]);
  assert.equal(r.assignTo, "sam", "an assignee who can't take tickets is skipped");
  assert.equal(r.status, "pending");
  assert.deepEqual(r.notes, ["Check Stripe."]);
  assert.deepEqual(ticket.tags, [], "the input isn't changed");
});

test("the form: empty rows skipped, channel checked, needs a condition and an action", () => {
  const form = (v: Record<string, string>) => (k: string) => v[k] ?? "";
  const norm = (t: string[]) => t.map((x) => x.trim().toLowerCase()).filter(Boolean);
  const ok = triggerFromForm(form({ name: "VIP", match: "any", c0_field: "from", c0_value: "@bigfirm.com", c2_field: "channel", c2_op: "excludes", c2_value: "Chat", addTags: "VIP, priority", assignTo: "sam" }), norm);
  assert.ok(!("error" in ok));
  assert.equal(ok.matchAll, false);
  assert.deepEqual(ok.conditions, [
    { field: "from", op: "includes", value: "@bigfirm.com" },
    { field: "channel", op: "is_not", value: "chat" },
  ]);
  assert.deepEqual(ok.actions, [{ type: "add_tags", tags: ["vip", "priority"] }, { type: "assign", to: "sam" }]);
  assert.ok("error" in triggerFromForm(form({ name: "x", c0_field: "channel", c0_value: "phone", addTags: "a" }), norm));
  assert.ok("error" in triggerFromForm(form({ name: "x", addTags: "a" }), norm));
  assert.ok("error" in triggerFromForm(form({ name: "x", c0_value: "a" }), norm));
});

test("status conditions, and timed triggers that email the customer", () => {
  const pending = { ...ticket, status: "pending" as const };
  assert.ok(conditionMatches({ field: "status", op: "is", value: "pending" }, pending));
  assert.ok(!conditionMatches({ field: "status", op: "is_not", value: "pending" }, pending));
  const r = runTriggers([trig({ name: "Nudge", conditions: [{ field: "status", op: "is", value: "pending" }], actions: [{ type: "reply", body: "Still need help?" }, { type: "add_tags", tags: ["nudged"] }] })], pending, () => true);
  assert.deepEqual(r.replies, ["Still need help?"]);
  assert.deepEqual(r.tags, ["nudged"]);

  const form = (v: Record<string, string>) => (k: string) => v[k] ?? "";
  const norm = (t: string[]) => t.map((x) => x.trim().toLowerCase()).filter(Boolean);
  const timed = triggerFromForm(form({ name: "Nudge", event: "timed", hours: "72", c0_field: "status", c0_value: "Pending", reply: "Still need help?" }), norm);
  assert.ok(!("error" in timed));
  assert.equal(timed.event, "timed");
  assert.equal(timed.hours, 72);
  assert.deepEqual(timed.conditions, [{ field: "status", op: "is", value: "pending" }]);
  assert.match((triggerFromForm(form({ name: "x", event: "created", c0_field: "subject", c0_value: "a", reply: "hi" }), norm) as { error: string }).error, /Only timed/);
  assert.match((triggerFromForm(form({ name: "x", event: "timed", hours: "0", c0_field: "subject", c0_value: "a", note: "n" }), norm) as { error: string }).error, /hours/);
  assert.ok("error" in triggerFromForm(form({ name: "x", c0_field: "status", c0_value: "solved", note: "n" }), norm));
});

test("Zendesk automations become timed triggers", () => {
  const made = toTrigger(
    [{ field: "status", operator: "is", value: "pending" }, { field: "hours_since_pending", operator: "greater_than", value: "71" }, { field: "current_tags", operator: "not_includes", value: "nudged" }],
    [],
    [{ field: "notification_user", value: ["requester_id", "Checking in", "Did that help? Reply if not."] }, { field: "current_tags", value: "nudged" }],
    "timed",
  );
  assert.ok("trigger" in made);
  assert.equal(made.trigger.event, "timed");
  assert.equal(made.trigger.hours, 72);
  assert.deepEqual(made.trigger.conditions, [{ field: "status", op: "is", value: "pending" }, { field: "tags", op: "excludes", value: "nudged" }]);
  assert.deepEqual(made.trigger.actions, [{ type: "add_tags", tags: ["nudged"] }, { type: "reply", body: "Did that help? Reply if not." }]);
  const close = toTrigger([{ field: "status", operator: "is", value: "solved" }, { field: "hours_since_solved", operator: "greater_than", value: "95" }], [], [{ field: "status", value: "closed" }], "timed");
  assert.ok("trigger" in close && close.trigger.hours === 96);
  const placeholder = toTrigger([{ field: "status", operator: "is", value: "pending" }, { field: "hours_since_update", operator: "is", value: "24" }], [], [{ field: "notification_user", value: ["requester_id", "Hi", "Hi {{ticket.requester.first_name}}"] }], "timed");
  assert.ok("blocker" in placeholder && /placeholders/.test(placeholder.blocker));
  const business = toTrigger([{ field: "status", operator: "is", value: "pending" }, { field: "hours_since_update", operator: "greater_than_business_hours", value: "24" }], [], [{ field: "status", value: "closed" }], "timed");
  assert.ok("blocker" in business);
});

test("Zendesk triggers that fit become Flatdesk triggers; the rest say why not", () => {
  const made = toTrigger(
    [{ field: "update_type", operator: "is", value: "Create" }, { field: "comment_includes_word", operator: "includes", value: "refund chargeback" }, { field: "via_id", operator: "is", value: 4 }],
    [],
    [{ field: "current_tags", value: "billing Urgent" }, { field: "assignee_id", value: "901" }, { field: "status", value: "hold" }],
  );
  assert.ok("trigger" in made);
  assert.deepEqual(made.trigger, {
    matchAll: true,
    conditions: [{ field: "body", op: "includes", value: "refund, chargeback" }, { field: "channel", op: "is", value: "email" }],
    actions: [{ type: "add_tags", tags: ["billing", "urgent"] }, { type: "assign_external", agentExternalId: "901" }, { type: "set_status", status: "pending" }],
  });
  const updates = toTrigger([{ field: "update_type", operator: "is", value: "Change" }, { field: "current_tags", operator: "includes", value: "vip" }], [], [{ field: "status", value: "open" }]);
  assert.ok("blocker" in updates && /update/.test(updates.blocker));
  const mail = toTrigger([{ field: "update_type", operator: "is", value: "Create" }, { field: "current_tags", operator: "includes", value: "vip" }], [], [{ field: "notification_user", value: ["requester_id", "Hi", "Got it"] }]);
  assert.ok("blocker" in mail && /email/.test(mail.blocker));
  const any = toTrigger([{ field: "status", operator: "is", value: "new" }], [{ field: "subject_includes_word", operator: "is", value: "server down" }, { field: "current_tags", operator: "includes", value: "outage" }], [{ field: "current_tags", value: "p1" }]);
  assert.ok("trigger" in any);
  assert.equal(any.trigger.matchAll, false);
  assert.deepEqual(any.trigger.conditions[0], { field: "subject", op: "includes", value: "server down" });
});

const ORG = "org_triggers_test";
after(async () => {
  if (process.env.DATABASE_URL) await (await import("@/db")).pool.end();
});

test("database: a new ticket runs triggers, and a late one is escalated once", { skip: !process.env.DATABASE_URL }, async () => {
  const { db, schema } = await import("@/db");
  const { createTicket } = await import("./tickets");
  const { escalateOverdue, OVERDUE_TAG } = await import("./escalation");

  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Trigger team", inboundKey: "trig00001", firstResponseMinutes: 60, businessHours: null });
  await db.insert(schema.agents).values([
    { orgId: ORG, userId: "u_sam", name: "Sam", email: "sam@x.com", role: "agent" },
    { orgId: ORG, userId: "u_lead", name: "Lee", email: "lee@x.com", role: "admin" },
  ]);
  await db.insert(schema.triggers).values([
    { orgId: ORG, name: "Billing", position: 0, conditions: [{ field: "subject_or_body", op: "includes", value: "refund" }], actions: [{ type: "add_tags", tags: ["billing"] }] },
    { orgId: ORG, name: "Billing to Sam", position: 1, conditions: [{ field: "tags", op: "includes", value: "billing" }], actions: [{ type: "assign", to: "u_sam" }, { type: "note", body: "Check Stripe first." }] },
  ]);

  const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: "ana@bigfirm.com", subject: "Refund", body: "Please refund March.", authorType: "customer" });
  assert.deepEqual(t.tags, ["billing"]);
  assert.equal(t.assigneeId, "u_sam");
  const notes = await db.select().from(schema.messages).where(eq(schema.messages.ticketId, t.id));
  const note = notes.find((m) => m.authorType === "system");
  assert.ok(note?.internal);
  assert.match(note!.body, /Billing, Billing to Sam\.[\s\S]*Check Stripe first\./);
  assert.ok(note!.createdAt > notes.find((m) => m.authorType === "customer")!.createdAt, "the note sorts under the customer's message");

  const quiet = await createTicket({ orgId: ORG, channel: "chat", customerEmail: "bo@x.com", subject: "Hello", body: "Hi", authorType: "customer" });
  assert.equal(quiet.assigneeId, null);
  assert.equal((await db.select().from(schema.messages).where(eq(schema.messages.ticketId, quiet.id))).length, 1, "no note when nothing ran");

  // Two hours later, with the lead set as the escalation person.
  await db.update(schema.orgs).set({ escalateTo: "u_lead" }).where(eq(schema.orgs.id, ORG));
  const later = new Date(Date.now() + 2 * 3600_000);
  await escalateOverdue(later);
  const [a, b] = await Promise.all([t.id, quiet.id].map((id) => db.query.tickets.findFirst({ where: eq(schema.tickets.id, id) })));
  for (const x of [a!, b!]) {
    assert.ok(x.escalatedAt);
    assert.ok(x.tags.includes(OVERDUE_TAG));
    assert.equal(x.assigneeId, "u_lead");
  }
  const escNote = (await db.select().from(schema.messages).where(eq(schema.messages.ticketId, t.id))).find((m) => m.body.startsWith("Missed"));
  assert.match(escNote!.body, /Handed to Lee \(it was with Sam\)/);
  // Once only.
  const again = await escalateOverdue(new Date(later.getTime() + 600_000));
  const mine = await db.select().from(schema.tickets).where(eq(schema.tickets.orgId, ORG));
  assert.ok(mine.every((x) => x.escalatedAt?.getTime() === later.getTime()));
  assert.ok(again.escalated >= 0);

  // Resolution target: three days later it's still not closed.
  await db.update(schema.orgs).set({ resolveMinutes: 1440 }).where(eq(schema.orgs.id, ORG));
  await db.update(schema.tickets).set({ status: "pending", firstResponseAt: later }).where(eq(schema.tickets.id, t.id));
  const r = await escalateOverdue(new Date(Date.now() + 3 * 86_400_000));
  assert.ok(r.resolveEscalated >= 2);
  const resolved = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, t.id) });
  assert.ok(resolved!.resolveEscalatedAt);
  assert.ok((await db.select().from(schema.messages).where(eq(schema.messages.ticketId, t.id))).some((m) => m.body.startsWith("Missed the resolution target")));
  const r2 = await escalateOverdue(new Date(Date.now() + 3 * 86_400_000 + 600_000));
  const mineAgain = await db.select().from(schema.tickets).where(eq(schema.tickets.orgId, ORG));
  assert.ok(mineAgain.every((x) => x.resolveEscalatedAt?.getTime() === resolved!.resolveEscalatedAt!.getTime()), "once only");
  assert.ok(r2.resolveEscalated >= 0);

  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
});

const ORG2 = "org_triggers_test2";

test("database: customer-writes-back and timed triggers", { skip: !process.env.DATABASE_URL }, async () => {
  const { db, schema } = await import("@/db");
  const { addCustomerMessage, addReply, createTicket } = await import("./tickets");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG2));
  await db.insert(schema.orgs).values({ id: ORG2, name: "Timed team", inboundKey: "trig00002", firstResponseMinutes: null });
  await db.insert(schema.agents).values({ orgId: ORG2, userId: "u_kim", name: "Kim", email: "kim@x.com", role: "admin" });
  await db.insert(schema.triggers).values([
    { orgId: ORG2, name: "Reopened", event: "updated", position: 0, conditions: [{ field: "status", op: "is", value: "closed" }], actions: [{ type: "add_tags", tags: ["reopened"] }, { type: "assign", to: "u_kim" }] },
    { orgId: ORG2, name: "Nudge", event: "timed", hours: 72, position: 1, conditions: [{ field: "status", op: "is", value: "pending" }], actions: [{ type: "reply", body: "Still need help?" }, { type: "add_tags", tags: ["nudged"] }] },
    { orgId: ORG2, name: "Close", event: "timed", hours: 96, position: 2, conditions: [{ field: "tags", op: "includes", value: "nudged" }, { field: "status", op: "is", value: "pending" }], actions: [{ type: "set_status", status: "closed" }] },
  ]);
  const t = await createTicket({ orgId: ORG2, channel: "email", customerEmail: "cy@x.com", subject: "Help", body: "Hi", authorType: "customer" });
  const get = () => db.query.tickets.findFirst({ where: eq(schema.tickets.id, t.id) }).then((x) => x!);
  const msgs = () => db.select().from(schema.messages).where(eq(schema.messages.ticketId, t.id));

  // Customer writes back on an open ticket: "status is closed" doesn't match.
  await addCustomerMessage({ orgId: ORG2, ticketId: t.id, customerId: t.customerId, body: "Hello?" });
  assert.deepEqual((await get()).tags, []);
  await addReply({ orgId: ORG2, ticketId: t.id, userId: "u_kim", body: "Try this.", internal: false, status: "closed" });
  await addCustomerMessage({ orgId: ORG2, ticketId: t.id, customerId: t.customerId, body: "Didn't work" });
  let now = await get();
  assert.equal(now.status, "open");
  assert.deepEqual(now.tags, ["reopened"]);
  assert.equal(now.assigneeId, "u_kim");

  // Pending, then 73 hours pass: nudged once, by email from the team.
  await addReply({ orgId: ORG2, ticketId: t.id, userId: "u_kim", body: "Any luck?", internal: false, status: "pending" });
  const base = (await get()).updatedAt.getTime();
  const at = (h: number) => new Date(base + h * 3_600_000);
  const first = await runTimedTriggers(at(73));
  assert.equal(first.emails.filter((e) => e.orgId === ORG2).length, 1);
  now = await get();
  assert.ok(now.tags.includes("nudged"));
  const sent = (await msgs()).filter((m) => m.authorType === "system" && !m.internal);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body, "Still need help?");
  // Not twice, even later.
  await runTimedTriggers(at(80));
  assert.equal((await msgs()).filter((m) => m.authorType === "system" && !m.internal).length, 1);
  assert.equal((await get()).status, "pending");
  // 96 hours after the nudge, it closes.
  await runTimedTriggers(at(73 + 97));
  now = await get();
  assert.equal(now.status, "closed");

  // The customer writes again: the cycle starts over.
  await addCustomerMessage({ orgId: ORG2, ticketId: t.id, customerId: t.customerId, body: "Back again" });
  assert.deepEqual((await get()).timedRan, []);

  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG2));
});
