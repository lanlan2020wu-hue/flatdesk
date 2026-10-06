// Groups, sharing tickets in turn, away people and closing quiet tickets.
// Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { and, eq } from "drizzle-orm";

const ORG = "org_test_routing";

after(async () => {
  const { pool } = await import("@/db");
  await pool.end();
});

async function fresh(shareInTurn = false) {
  const { db, schema } = await import("@/db");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Acme", aiEnabled: false, shareInTurn });
  await db.insert(schema.agents).values([
    { orgId: ORG, userId: "u_ada", name: "Ada", email: "ada@acme.test", role: "admin" },
    { orgId: ORG, userId: "u_bo", name: "Bo", email: "bo@acme.test" },
    { orgId: ORG, userId: "u_cy", name: "Cy", email: "cy@acme.test" },
    { orgId: ORG, userId: "u_vi", name: "Vi", email: "vi@acme.test", viewer: true },
  ]);
}

const newTicket = async (subject = "Help") => {
  const { createTicket } = await import("./tickets");
  return createTicket({ orgId: ORG, channel: "email", customerEmail: "kim@example.com", subject, body: subject, authorType: "customer" });
};

test("sharing in turn: the team takes new tickets one by one, skipping away people and viewers", async () => {
  await fresh(true);
  const { shareTicket, setAway } = await import("./routing");
  const got: (string | null)[] = [];
  for (let i = 0; i < 4; i++) got.push(await shareTicket(ORG, (await newTicket()).id));
  assert.deepEqual(got, ["u_ada", "u_bo", "u_cy", "u_ada"]);

  await setAway(ORG, "u_bo", true);
  const next = [await shareTicket(ORG, (await newTicket()).id), await shareTicket(ORG, (await newTicket()).id)];
  assert.deepEqual(next, ["u_cy", "u_ada"], "Bo is away");

  // An assigned ticket is left alone, and calling twice changes nothing.
  const t = await newTicket();
  await shareTicket(ORG, t.id);
  assert.equal(await shareTicket(ORG, t.id), null);
});

test("off by default: nothing is shared unless the team or the ticket's group asks for it", async () => {
  await fresh(false);
  const { shareTicket, saveGroup } = await import("./routing");
  const { updateTicket } = await import("./tickets");
  assert.equal(await shareTicket(ORG, (await newTicket()).id), null);

  const plain = await saveGroup(ORG, { name: "Sales", shareInTurn: false, members: ["u_bo"] });
  const billing = await saveGroup(ORG, { name: "Billing", shareInTurn: true, members: ["u_bo", "u_cy", "u_vi", "u_nobody"] });
  assert.ok("id" in plain && "id" in billing);
  const a = await newTicket();
  await updateTicket(ORG, a.id, { groupId: plain.id });
  assert.equal(await shareTicket(ORG, a.id), null);

  const got = [];
  for (let i = 0; i < 3; i++) {
    const t = await newTicket();
    await updateTicket(ORG, t.id, { groupId: billing.id });
    got.push(await shareTicket(ORG, t.id));
  }
  assert.deepEqual(got, ["u_bo", "u_cy", "u_bo"], "only the group's members who can take tickets");

  const { listGroups } = await import("./routing");
  const [b] = (await listGroups(ORG)).filter((g) => g.name === "Billing");
  assert.deepEqual(b.members.sort(), ["u_bo", "u_cy"], "viewers and strangers aren't added");
  assert.deepEqual(await saveGroup(ORG, { name: "billing", shareInTurn: false, members: [] }), { error: "There's already a group called Billing." });
});

test("a trigger sends new tickets to a group, and My groups shows them to its members", async () => {
  await fresh(false);
  const { db, schema } = await import("@/db");
  const { saveGroup, deleteGroup } = await import("./routing");
  const { listTickets, viewCounts } = await import("./tickets");
  const g = await saveGroup(ORG, { name: "Billing", shareInTurn: false, members: ["u_bo"] });
  assert.ok("id" in g);
  await db.insert(schema.triggers).values({
    orgId: ORG,
    name: "Refunds to billing",
    conditions: [{ field: "subject_or_body", op: "includes", value: "refund" }],
    actions: [{ type: "group", groupId: g.id }],
  });
  const t = await newTicket("I want a refund");
  const other = await newTicket("Where is my order");
  const [row] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, t.id));
  assert.equal(row.groupId, g.id);

  assert.deepEqual((await listTickets(ORG, "u_bo", "groups")).map((x) => x.number), [t.number]);
  assert.equal((await viewCounts(ORG, "u_bo")).groups, 1);
  assert.equal((await viewCounts(ORG, "u_cy")).groups, null, "no tab for people in no group");
  assert.ok(other);

  await deleteGroup(ORG, g.id);
  const [after] = await db.select().from(schema.tickets).where(and(eq(schema.tickets.orgId, ORG), eq(schema.tickets.id, t.id)));
  assert.equal(after.groupId, null, "tickets keep their place without a group");
  // A trigger pointing at a deleted group does nothing.
  const late = await newTicket("refund again");
  const [lateRow] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, late.id));
  assert.equal(lateRow.groupId, null);
});

test("auto-close is a timed trigger: pending tickets quiet for the set days close with a note", async () => {
  await fresh(false);
  const { db, schema } = await import("@/db");
  const { addAutoCloseTrigger, autoCloseTriggers } = await import("./routing");
  const { runTimedTriggers } = await import("./triggers");
  const { updateTicket } = await import("./tickets");
  assert.deepEqual(await addAutoCloseTrigger(ORG, 2), { error: "Pick how many days." });
  assert.deepEqual(await addAutoCloseTrigger(ORG, 7), { ok: true });
  assert.equal((await autoCloseTriggers(ORG)).length, 1);

  const quiet = await newTicket("Quiet");
  const fresh2 = await newTicket("Fresh");
  const open = await newTicket("Open");
  for (const t of [quiet, fresh2]) await updateTicket(ORG, t.id, { status: "pending" });
  const old = new Date(Date.now() - 8 * 24 * 3600_000);
  await db.update(schema.tickets).set({ updatedAt: old }).where(eq(schema.tickets.id, quiet.id));
  await db.update(schema.tickets).set({ updatedAt: old }).where(eq(schema.tickets.id, open.id));
  await runTimedTriggers();
  const status = async (id: string) => (await db.select({ s: schema.tickets.status }).from(schema.tickets).where(eq(schema.tickets.id, id)))[0].s;
  assert.equal(await status(quiet.id), "closed");
  assert.equal(await status(fresh2.id), "pending");
  assert.equal(await status(open.id), "open");
});
