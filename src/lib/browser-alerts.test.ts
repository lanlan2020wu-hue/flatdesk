// Browser alerts. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";

const ORG = "org_test_browser_alerts";

if (process.env.DATABASE_URL) {
  after(async () => {
    const { db, schema, pool } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await pool.end();
  });

  test("database: new tickets that need a person, and tickets given to you", async () => {
    const { db, schema } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await db.insert(schema.orgs).values({ id: ORG, name: "Acme" });
    const [billing] = await db.insert(schema.groups).values({ orgId: ORG, name: "Billing" }).returning();
    await db.insert(schema.groupMembers).values({ orgId: ORG, groupId: billing.id, userId: "user_bo" });
    const { createTicket } = await import("./tickets");
    const { alertsSince, markNeedsTeam } = await import("./browser-alerts");
    const mk = (subject: string) => createTicket({ orgId: ORG, channel: "email", customerEmail: `${subject.toLowerCase()}@example.com`, customerName: subject, subject, body: "Help", authorType: "customer" });
    const set = (id: string, v: Partial<typeof schema.tickets.$inferInsert>) => db.update(schema.tickets).set(v).where(eq(schema.tickets.id, id));

    // The first ask only sets the clock.
    const start = await alertsSince(ORG, "user_ada", null);
    assert.deepEqual(start.alerts, []);
    const since = new Date(start.now);

    const help = await mk("Help");
    const answered = await mk("Answered");
    const billingTicket = await mk("Invoice");
    await set(answered.id, { resolvedByAi: true, status: "pending" });
    await set(billingTicket.id, { groupId: billing.id });
    for (const t of [help, answered, billingTicket]) await markNeedsTeam(ORG, t.id);

    const forAda = await alertsSince(ORG, "user_ada", since);
    assert.deepEqual(forAda.alerts.map((a) => [a.kind, a.number]), [["new", help.number]], "not the AI's answer, not another group's ticket");
    assert.equal(forAda.alerts[0].customer, "Help");
    const forBo = await alertsSince(ORG, "user_bo", since);
    assert.deepEqual(forBo.alerts.map((a) => a.number).sort(), [help.number, billingTicket.number].sort());

    // Assigning, however it happens, is news to the assignee; the ticket is no longer "new" for others.
    await set(help.id, { assigneeId: "user_ada" });
    const after1 = await alertsSince(ORG, "user_ada", since);
    assert.deepEqual(after1.alerts.map((a) => [a.kind, a.number]), [["assigned", help.number]]);
    assert.ok(!(await alertsSince(ORG, "user_bo", since)).alerts.some((a) => a.number === help.number));
    const [row] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, help.id));
    assert.ok(row.assignedAt);
    await set(help.id, { assigneeId: null });
    assert.equal((await db.select().from(schema.tickets).where(eq(schema.tickets.id, help.id)))[0].assignedAt, null);

    // An AI answer handed back to the team counts again; closed tickets don't.
    await markNeedsTeam(ORG, answered.id, true);
    assert.ok((await alertsSince(ORG, "user_ada", since)).alerts.some((a) => a.number === answered.number));
    await set(answered.id, { status: "closed" });
    assert.ok(!(await alertsSince(ORG, "user_ada", since)).alerts.some((a) => a.number === answered.number));

    // Long gone: nothing from before the lookback.
    assert.deepEqual((await alertsSince(ORG, "user_bo", new Date(Date.now() + 60_000))).alerts, []);
  });
}
