// Splitting tickets, merging customers and tidying tags. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";

const ORG = "org_test_ticket_tools";

if (process.env.DATABASE_URL) {
  after(async () => {
    const { db, schema, pool } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await pool.end();
  });

  test("database: split, merge customers, rename and remove tags", async () => {
    const { db, schema } = await import("@/db");
    const { and } = await import("drizzle-orm");
    const { createTicket } = await import("./tickets");
    const { splitTicket } = await import("./split");
    const { mergeCustomers, CustomerMergeError } = await import("./customer-merge");
    const { deleteTag, renameTag, tagCounts, TagError } = await import("./tag-manager");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await db.insert(schema.orgs).values({ id: ORG, name: "Acme", aiEnabled: false, inboundKey: "toolskey00001" });

    // Split: the second message becomes its own ticket for the same customer.
    const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: "jo@acme.test", subject: "Invoice", body: "Where is my invoice?", authorType: "customer", tags: ["billing", "vip"] });
    const [later] = await db.insert(schema.messages).values({ orgId: ORG, ticketId: t.id, authorType: "customer", authorId: t.customerId, body: "Also, how do I export my data?\nThanks" }).returning();
    assert.deepEqual(await splitTicket(ORG, t.messageId, "Sam"), { error: "That's the ticket's first message. Split a later one." });
    const split = await splitTicket(ORG, later.id, "Sam");
    assert.ok("number" in split && split.number === t.number + 1);
    const [moved] = await db.select().from(schema.messages).where(eq(schema.messages.id, later.id));
    const [child] = await db.select().from(schema.tickets).where(and(eq(schema.tickets.orgId, ORG), eq(schema.tickets.number, t.number + 1)));
    assert.equal(moved.ticketId, child.id);
    assert.equal(child.subject, "Also, how do I export my data?");
    assert.equal(child.customerId, t.customerId);
    assert.deepEqual(child.tags.sort(), ["billing", "vip"]);
    const notes = await db.select().from(schema.messages).where(and(eq(schema.messages.ticketId, t.id), eq(schema.messages.authorType, "system")));
    assert.ok(notes.some((n) => n.body.includes(`#${child.number}`)));

    // Merge customers: tickets move, the old address stays on as a cc, the record goes.
    const other = await createTicket({ orgId: ORG, channel: "email", customerEmail: "jo.smith@acme.test", customerName: "Jo Smith", subject: "Login", body: "Can't log in", authorType: "customer", tags: ["login"] });
    await db.update(schema.customers).set({ notes: "Prefers phone", vip: true }).where(eq(schema.customers.id, other.customerId));
    await assert.rejects(() => mergeCustomers(ORG, other.customerId, "nobody@acme.test"), CustomerMergeError);
    await assert.rejects(() => mergeCustomers(ORG, other.customerId, "jo.smith@acme.test"), CustomerMergeError);
    assert.deepEqual(await mergeCustomers(ORG, other.customerId, "JO@acme.test"), { email: "jo@acme.test" });
    const [moved2] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, other.id));
    assert.equal(moved2.customerId, t.customerId);
    assert.deepEqual(moved2.cc, ["jo.smith@acme.test"]);
    const [keep] = await db.select().from(schema.customers).where(eq(schema.customers.id, t.customerId));
    assert.equal(keep.vip, true);
    assert.match(keep.notes ?? "", /Prefers phone/);
    assert.equal(await db.query.customers.findFirst({ where: eq(schema.customers.id, other.customerId) }), undefined);
    const [msg] = await db.select().from(schema.messages).where(eq(schema.messages.ticketId, other.id));
    assert.equal(msg.authorId, t.customerId);

    // Tags: rename across tickets, macros, rules and views; fold into an existing tag; remove.
    await db.insert(schema.macros).values({ orgId: ORG, name: "Billing", body: "Hi", addTags: ["billing"] });
    await db.insert(schema.savedViews).values({ orgId: ORG, createdBy: "u1", name: "Billing", filters: { tags: ["billing", "urgent"] } });
    assert.equal(await renameTag(ORG, "billing", "Invoices"), 2);
    const counts = await tagCounts(ORG);
    assert.equal(counts.find((c) => c.tag === "invoices")?.tickets, 2);
    assert.ok(!counts.some((c) => c.tag === "billing"));
    const [macro] = await db.select().from(schema.macros).where(eq(schema.macros.orgId, ORG));
    assert.deepEqual(macro.addTags, ["invoices"]);
    const [view] = await db.select().from(schema.savedViews).where(eq(schema.savedViews.orgId, ORG));
    assert.deepEqual(view.filters.tags?.sort(), ["invoices", "urgent"]);
    assert.equal(await renameTag(ORG, "login", "invoices"), 1);
    assert.equal(await deleteTag(ORG, "vip"), 2);
    await assert.rejects(() => renameTag(ORG, "invoices", "invoices"), TagError);
  });
}
