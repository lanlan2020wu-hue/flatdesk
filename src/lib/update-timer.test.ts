// "Update the customer every N hours" and the optional webhook events. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { parseUpdateEvery } from "./update-timer";

process.env.ALERTS_ALLOW_PRIVATE = "1";
process.env.INBOUND_DOMAIN = "in.flatdesk.test";
const ORG = "org_test_update_timer";

test("only the offered intervals are accepted", () => {
  assert.equal(parseUpdateEvery("24"), 24);
  assert.equal(parseUpdateEvery("168"), 168);
  assert.equal(parseUpdateEvery(""), null);
  assert.equal(parseUpdateEvery("5"), null);
  assert.equal(parseUpdateEvery("abc"), null);
});

if (process.env.DATABASE_URL) {
  const posts: string[] = [];
  const hook = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      posts.push(body);
      res.end("ok");
    });
  });
  after(async () => {
    hook.close();
    const { db, schema, pool } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await pool.end();
  });

  test("database: a ticket with a timer is tagged and posted when due, and a reply restarts it", async () => {
    const { db, schema } = await import("@/db");
    const { createTicket, addReply } = await import("./tickets");
    const { alertEvent } = await import("./alerts");
    const { runUpdateTimers, setUpdateEvery } = await import("./update-timer");
    await new Promise<void>((r) => hook.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/hook`;
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await db.insert(schema.orgs).values({ id: ORG, name: "Timer team", inboundKey: "timerkey0001", widgetKey: "timerwidget1", aiEnabled: false, alertWebhookUrl: url });
    await db.insert(schema.agents).values({ orgId: ORG, userId: "u1", name: "Ana", email: "ana@acme.test", role: "admin" });
    const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: "kim@acme.test", subject: "Outage", body: "Is it down?", authorType: "customer" });
    const get = async () => (await db.select().from(schema.tickets).where(eq(schema.tickets.id, t.id)))[0];

    const t0 = new Date("2026-10-10T10:00:00Z");
    await setUpdateEvery(ORG, t.id, 4, t0);
    assert.equal((await get()).updateDueAt?.toISOString(), "2026-10-10T14:00:00.000Z");
    assert.deepEqual(await runUpdateTimers(new Date("2026-10-10T13:59:00Z")), { due: 0 });

    // Due: tagged, a note, a post, and the next reminder a period later.
    const now = new Date("2026-10-10T14:01:00Z");
    assert.deepEqual(await runUpdateTimers(now), { due: 1 });
    const due = await get();
    assert.ok(due.tags.includes("update-due"));
    assert.equal(due.updateDueAt?.toISOString(), "2026-10-10T18:01:00.000Z");
    const notes = await db.select().from(schema.messages).where(eq(schema.messages.ticketId, t.id));
    assert.ok(notes.some((m) => m.authorType === "system" && /update the customer/.test(m.body)));
    assert.equal(posts.length, 1);
    assert.equal(JSON.parse(posts[0]).event, "ticket.update_due");
    assert.deepEqual(await runUpdateTimers(now), { due: 0 }, "not twice for the same period");

    // An internal note doesn't count; a public reply restarts the clock and clears the tag.
    await addReply({ orgId: ORG, ticketId: t.id, userId: "u1", body: "note", internal: true });
    assert.ok((await get()).tags.includes("update-due"));
    await addReply({ orgId: ORG, ticketId: t.id, userId: "u1", body: "We're on it.", internal: false });
    const replied = await get();
    assert.ok(!replied.tags.includes("update-due"));
    assert.ok(replied.updateDueAt && replied.updateDueAt.getTime() > Date.now() + 3 * 3_600_000);

    // Closing drops the due time; turning the timer off clears it.
    await addReply({ orgId: ORG, ticketId: t.id, userId: "u1", body: "", internal: true, status: "closed" });
    assert.equal((await get()).updateDueAt, null);
    await setUpdateEvery(ORG, t.id, null);
    assert.equal((await get()).updateEveryHours, null);

    // Optional events only post when the team asked for them.
    posts.length = 0;
    await alertEvent(ORG, t.id, "ticket.replied", "Ana");
    assert.equal(posts.length, 0);
    await db.update(schema.orgs).set({ alertEvents: ["ticket.replied"] }).where(eq(schema.orgs.id, ORG));
    await alertEvent(ORG, t.id, "ticket.replied", "Ana");
    await alertEvent(ORG, t.id, "ticket.closed");
    assert.equal(posts.length, 1);
    assert.match(JSON.parse(posts[0]).text, /^Ana replied on #\d+ Outage to kim@acme\.test\.$/);
  });
}
