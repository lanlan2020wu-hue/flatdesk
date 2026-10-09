// Saved inbox views. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { describeView, parseViewForm, ViewError } from "./saved-views";

const ORG = "org_test_views";
const form = (o: Record<string, string | string[]>) => ({
  get: (k: string) => {
    const v = o[k];
    return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
  },
  getAll: (k: string) => {
    const v = o[k];
    return Array.isArray(v) ? v : v ? [v] : [];
  },
});
const parse = (o: Record<string, string | string[]>) => {
  const f = form(o);
  return parseViewForm(f.get, f.getAll);
};

test("a view needs a name and at least one filter", () => {
  assert.deepEqual(parse({ name: "  Urgent   billing ", assignee: "unassigned", priority: ["urgent", "high", "bogus"], tags: "Billing, refund,billing" }), {
    name: "Urgent billing",
    filters: { assignee: "unassigned", priorities: ["urgent", "high"], tags: ["billing", "refund"] },
    shared: false,
  });
  // Every priority ticked is the same as none.
  assert.deepEqual(parse({ name: "All", status: "closed", priority: ["low", "normal", "high", "urgent"] }).filters, { status: "closed" });
  assert.deepEqual(parse({ name: "Business", fieldName: "Plan", fieldValue: "Business", shared: "on" }), {
    name: "Business",
    filters: { field: { name: "Plan", value: "Business" } },
    shared: true,
  });
  assert.throws(() => parse({ name: "", status: "open" }), ViewError);
  assert.throws(() => parse({ name: "Nothing" }), ViewError);
  assert.throws(() => parse({ name: "Half", fieldName: "Plan" }), ViewError);
  assert.throws(() => parse({ name: "x".repeat(41), status: "open" }), ViewError);
});

test("the line under the tabs says what the view holds", () => {
  const names = { agent: () => "Ada", group: () => "Billing" };
  assert.equal(describeView({ priorities: ["urgent"], assignee: "unassigned", tags: ["billing"] }, names), "Open and pending, urgent priority, unassigned, tagged billing.");
  assert.equal(describeView({ status: "closed", channel: "chat", assignee: "u1", groupId: "g1" }, names), "Closed, chats, assigned to Ada, in Billing.");
  assert.equal(describeView({ field: { name: "Plan", value: "Pro" }, groupId: "mine", assignee: "me" }, names), "Open and pending, assigned to you, in your groups, where Plan is Pro.");
});

if (process.env.DATABASE_URL) {
  after(async () => {
    const { db, schema, pool } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await pool.end();
  });

  test("database: views filter the inbox, stay private unless an admin shares them", async () => {
    const { db, schema } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await db.insert(schema.orgs).values({ id: ORG, name: "Acme" });
    await db.insert(schema.agents).values([
      { orgId: ORG, userId: "user_ada", name: "Ada", email: "ada@acme.test", role: "admin" },
      { orgId: ORG, userId: "user_bo", name: "Bo", email: "bo@acme.test", role: "agent" },
    ]);
    const [billing] = await db.insert(schema.groups).values({ orgId: ORG, name: "Billing" }).returning();
    await db.insert(schema.groupMembers).values({ orgId: ORG, groupId: billing.id, userId: "user_bo" });
    const { createTicket } = await import("./tickets");
    const { createView, deleteView, findView, viewCount, viewsFor, viewTickets, VIEW_LIMITS } = await import("./saved-views");

    const mk = (subject: string, channel: "email" | "chat" = "email") =>
      createTicket({ orgId: ORG, channel, customerEmail: `${subject.toLowerCase()}@example.com`, customerName: subject, subject, body: "Help", authorType: "customer" });
    const a = await mk("Refund");
    const b = await mk("Chat", "chat");
    const c = await mk("Closed");
    const d = await mk("Snoozed");
    await db.update(schema.tickets).set({ priority: "urgent", tags: ["billing", "vip"], groupId: billing.id, fields: { Plan: "Business" } }).where(eq(schema.tickets.id, a.id));
    await db.update(schema.tickets).set({ assigneeId: "user_bo" }).where(eq(schema.tickets.id, b.id));
    await db.update(schema.tickets).set({ status: "closed", tags: ["billing"] }).where(eq(schema.tickets.id, c.id));
    await db.update(schema.tickets).set({ tags: ["billing"], snoozedUntil: new Date(Date.now() + 86_400_000) }).where(eq(schema.tickets.id, d.id));

    const ids = async (user: string, f: Parameters<typeof viewTickets>[2]) => (await viewTickets(ORG, user, f)).map((t) => t.id).sort();
    // Open and pending by default; closed and snoozed tickets stay out.
    assert.deepEqual(await ids("user_ada", { tags: ["billing"] }), [a.id]);
    assert.deepEqual(await ids("user_ada", { status: "closed", tags: ["billing"] }), [c.id]);
    assert.deepEqual(await ids("user_ada", { priorities: ["urgent"], assignee: "unassigned" }), [a.id]);
    assert.deepEqual(await ids("user_bo", { assignee: "me" }), [b.id]);
    assert.deepEqual(await ids("user_bo", { groupId: "mine" }), [a.id]);
    assert.deepEqual(await ids("user_ada", { groupId: "mine" }), []);
    assert.deepEqual(await ids("user_ada", { channel: "chat" }), [b.id]);
    assert.deepEqual(await ids("user_ada", { field: { name: "Plan", value: "business" } }), [a.id]);
    assert.equal(await viewCount(ORG, "user_ada", { tags: ["vip", "nope"] }), 1);

    // Bo's view is Bo's; only an admin shares one, and everyone sees it.
    const mine = await createView(ORG, "user_bo", false, { name: "My chats", filters: { assignee: "me", channel: "chat" }, shared: false });
    await assert.rejects(createView(ORG, "user_bo", false, { name: "Team", filters: { status: "open" }, shared: true }), ViewError);
    const team = await createView(ORG, "user_ada", true, { name: "Urgent billing", filters: { priorities: ["urgent"], tags: ["billing"] }, shared: true });
    assert.deepEqual((await viewsFor(ORG, "user_bo")).map((v) => v.name), ["My chats", "Urgent billing"]);
    assert.deepEqual((await viewsFor(ORG, "user_ada")).map((v) => v.name), ["Urgent billing"]);
    assert.equal(await findView(ORG, "user_ada", mine.id), null, "someone else's view can't be opened");
    assert.equal(await deleteView(ORG, "user_ada", true, mine.id), null, "or deleted");
    await assert.rejects(deleteView(ORG, "user_bo", false, team.id), ViewError);

    // A limit on how many each person keeps.
    for (let i = 1; i < VIEW_LIMITS.perPerson; i++) await createView(ORG, "user_bo", false, { name: `V${i}`, filters: { status: "open" }, shared: false });
    await assert.rejects(createView(ORG, "user_bo", false, { name: "One more", filters: { status: "open" }, shared: false }), ViewError);
    assert.ok(await deleteView(ORG, "user_bo", false, mine.id));
    assert.ok(await deleteView(ORG, "user_ada", true, team.id));
    assert.equal((await viewsFor(ORG, "user_bo")).length, VIEW_LIMITS.perPerson - 1);
  });
}
