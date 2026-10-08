// Customer data requests: export and erase. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { maskEmail } from "./customer-data";

process.env.INBOUND_DOMAIN = "in.flatdesk.test";
const ORG = "org_test_customer_data";
const KEY = "custdata0001";

test("the audit log keeps a masked address", () => {
  assert.equal(maskEmail("kim@example.com"), "k***@example.com");
});

if (process.env.DATABASE_URL) {
  after(async () => {
    const { db, schema, pool } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await pool.end();
  });

  const mail = (from: string, subject: string, extra = {}) => ({ from, to: [`${KEY}@in.flatdesk.test`], subject, text: `${subject} body`, headers: null, messageId: `<${Math.random()}@example.com>`, ...extra });

  test("database: a customer's data downloads, then erases with everything about them", async () => {
    const { db, schema } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await db.insert(schema.orgs).values({ id: ORG, name: "Acme", aiEnabled: false, inboundKey: KEY });
    const { handleInboundEmail } = await import("./inbound");
    const { addSystemNote } = await import("./tickets");
    const { customerExport, eraseCustomer } = await import("./customer-data");

    const kim1 = await handleInboundEmail(mail("Kim <kim@example.com>", "Refund please"));
    const kim2 = await handleInboundEmail(mail("kim@example.com", "Address change"));
    await addSystemNote(ORG, kim1.ticketId!, "Internal: VIP");
    // Lee's ticket with Kim copied; Kim replies on it.
    const lee = await handleInboundEmail({ ...mail("lee@example.com", "Team order"), copied: ["kim@example.com"] });
    const leeTicket = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, lee.ticketId!) });
    assert.deepEqual(leeTicket?.cc, ["kim@example.com"]);
    const leeMsg = await db.query.messages.findFirst({ where: eq(schema.messages.ticketId, lee.ticketId!) });
    await handleInboundEmail(mail("kim@example.com", "Re: Team order", { headers: { "In-Reply-To": leeMsg!.emailMessageId! } }));

    const kim = await db.query.customers.findFirst({ where: and(eq(schema.customers.orgId, ORG), eq(schema.customers.email, "kim@example.com")) });
    const data = await customerExport(ORG, kim!.id);
    assert.equal(data?.customer.email, "kim@example.com");
    assert.deepEqual(data?.tickets.map((t) => t.subject), ["Refund please", "Address change"]);
    assert.equal(data?.tickets[0].messages.length, 1, "internal notes aren't in it");
    assert.equal(data?.messagesOnOtherTickets.length, 1);
    assert.equal(data?.messagesOnOtherTickets[0].ticket, leeTicket?.number);

    const gone = await eraseCustomer(ORG, kim!.id);
    assert.deepEqual(gone, { email: "kim@example.com", tickets: 2, otherMessages: 1 });
    assert.equal(await db.query.customers.findFirst({ where: eq(schema.customers.id, kim!.id) }), undefined);
    assert.equal(await db.query.tickets.findFirst({ where: eq(schema.tickets.id, kim1.ticketId!) }), undefined);
    assert.equal(await db.query.tickets.findFirst({ where: eq(schema.tickets.id, kim2.ticketId!) }), undefined);
    // Lee's ticket stays, without Kim's message or address.
    const leeAfter = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, lee.ticketId!) });
    assert.deepEqual(leeAfter?.cc, []);
    const leeThread = await db.select({ body: schema.messages.body }).from(schema.messages).where(eq(schema.messages.ticketId, lee.ticketId!));
    assert.ok(!leeThread.some((m) => m.body.includes("Re: Team order")));
    assert.ok(leeThread.length >= 1);
    assert.equal(await eraseCustomer(ORG, kim!.id), null);
  });
}
