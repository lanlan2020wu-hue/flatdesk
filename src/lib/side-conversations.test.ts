// Side conversations. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { and, eq, isNotNull } from "drizzle-orm";

process.env.INBOUND_DOMAIN = "in.flatdesk.test";

const ORG = "org_test_side";

test("a side conversation's reply address carries its token", async () => {
  const { matchRecipients } = await import("./email");
  const { sideReplyTo } = await import("./side-conversations");
  const to = sideReplyTo("sidetest01", "0123456789abcdef0123");
  assert.equal(to, "sidetest01+s0123456789abcdef0123@in.flatdesk.test");
  assert.deepEqual(matchRecipients([to!]), [{ key: "sidetest01", number: null, side: "0123456789abcdef0123" }]);
  assert.deepEqual(matchRecipients(["sidetest01+sNOPE@in.flatdesk.test"]), [{ key: "sidetest01", number: null, side: null }]);
});

if (process.env.DATABASE_URL) {
  after(async () => {
    const { db, schema, pool } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await pool.end();
  });

  test("database: email a supplier from a ticket and their answer comes back to it, never to the customer", async () => {
    const { db, schema } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await db.insert(schema.orgs).values({ id: ORG, name: "Shop", inboundKey: "sidetest01" });
    const { createTicket } = await import("./tickets");
    const { replySide, sidesFor, startSide, SideError } = await import("./side-conversations");
    const { handleInboundEmail } = await import("./inbound");

    const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: "cara@customer.test", customerName: "Cara", subject: "Parcel lost", body: "My parcel never came", authorType: "customer" });
    await db.update(schema.tickets).set({ status: "pending" }).where(eq(schema.tickets.id, t.id));

    await assert.rejects(startSide({ orgId: ORG, ticketId: t.id, userId: "user_ada", to: "cara@customer.test", subject: "x", body: "hi" }), SideError, "not the customer");
    await assert.rejects(startSide({ orgId: ORG, ticketId: t.id, userId: "user_ada", to: "nope", subject: "x", body: "hi" }), SideError);
    const side = await startSide({ orgId: ORG, ticketId: t.id, userId: "user_ada", to: "Lee <lee@courier.test>", subject: "Parcel 123", body: "Can you trace parcel 123?" });
    assert.equal(side.toEmail, "lee@courier.test");
    assert.equal(side.toName, "Lee");

    // The courier answers by the Reply-To token.
    const r1 = await handleInboundEmail({ from: "Lee <lee@courier.test>", to: [`sidetest01+s${side.token}@in.flatdesk.test`], subject: "Re: Parcel 123", text: "Found it, out for delivery.", headers: null, messageId: "<c1@courier.test>" });
    assert.equal(r1.ticket, t.number);
    assert.equal(r1.ticketId, undefined, "the AI doesn't run on it");
    const notes = await db.select().from(schema.messages).where(and(eq(schema.messages.ticketId, t.id), isNotNull(schema.messages.sideId)));
    assert.equal(notes.length, 2);
    assert.ok(notes.every((m) => m.internal), "the customer never sees them");
    const answer = notes.find((m) => m.authorType === "system")!;
    assert.equal(answer.body, "Found it, out for delivery.");
    assert.equal(answer.authorName, "Lee (lee@courier.test)");
    assert.equal((await db.query.tickets.findFirst({ where: eq(schema.tickets.id, t.id) }))?.status, "open", "back to Open so someone acts");

    // A duplicate delivery is ignored.
    const again = await handleInboundEmail({ from: "lee@courier.test", to: [`sidetest01+s${side.token}@in.flatdesk.test`], subject: "Re", text: "Found it", headers: null, messageId: "<c1@courier.test>" });
    assert.equal(again.ignored, "duplicate");

    // A reply that lost the Reply-To still finds its way by In-Reply-To, not into a new ticket.
    await replySide({ orgId: ORG, sideId: side.id, userId: "user_ada", body: "Thanks, when exactly?" });
    const ours = (await db.select().from(schema.messages).where(eq(schema.messages.sideId, side.id))).find((m) => m.body === "Thanks, when exactly?")!;
    await db.update(schema.messages).set({ emailMessageId: `<${ours.id}@mail.flatdesk.test>` }).where(eq(schema.messages.id, ours.id));
    const r2 = await handleInboundEmail({ from: "lee@courier.test", to: ["sidetest01@in.flatdesk.test"], subject: "Re: Parcel 123", text: "Tomorrow by noon.", headers: { "In-Reply-To": `<${ours.id}@mail.flatdesk.test>` }, messageId: "<c2@courier.test>" });
    assert.equal(r2.ticket, t.number);
    assert.equal(r2.action, "appended");
    const list = await sidesFor(ORG, t.id);
    assert.equal(list.length, 1);
    assert.equal(list[0].messages, 4);
    assert.equal(list[0].replies, 2);
    assert.equal((await db.select().from(schema.tickets).where(eq(schema.tickets.orgId, ORG))).length, 1, "no new ticket for the courier");
  });
}
