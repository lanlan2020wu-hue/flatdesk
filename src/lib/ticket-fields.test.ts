// Custom ticket fields. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { CHECKED, cleanValue, FieldError, missingMessage, missingRequired, parseFieldInput } from "./ticket-fields";

const ORG = "org_test_fields";
const form = (o: Record<string, string>) => (k: string) => o[k] ?? "";

test("a field needs a name and a kind; a dropdown needs choices", () => {
  assert.deepEqual(parseFieldInput(form({ name: "  Plan  tier ", kind: "dropdown", options: "Free, Pro,\nPro, Business", requiredToClose: "on" })), {
    name: "Plan tier",
    kind: "dropdown",
    options: ["Free", "Pro", "Business"],
    requiredToClose: true,
  });
  assert.deepEqual(parseFieldInput(form({ name: "Order", kind: "text", options: "ignored, here" })).options, []);
  assert.throws(() => parseFieldInput(form({ name: "", kind: "text" })), FieldError);
  assert.throws(() => parseFieldInput(form({ name: "Plan", kind: "color" })), FieldError);
  assert.throws(() => parseFieldInput(form({ name: "Plan", kind: "dropdown", options: "Only one" })), FieldError);
  assert.throws(() => parseFieldInput(form({ name: "Imported from", kind: "text" })), FieldError);
});

test("values are checked against the field's kind", () => {
  const plan = { name: "Plan", kind: "dropdown" as const, options: ["Free", "Pro"] };
  assert.equal(cleanValue(plan, "Pro"), "Pro");
  assert.equal(cleanValue(plan, ""), null);
  assert.throws(() => cleanValue(plan, "Gold"), FieldError);
  const amount = { name: "Amount", kind: "number" as const, options: [] };
  assert.equal(cleanValue(amount, " 1,250.50 "), "1250.5");
  assert.throws(() => cleanValue(amount, "lots"), FieldError);
  const refunded = { name: "Refunded", kind: "checkbox" as const, options: [] };
  assert.equal(cleanValue(refunded, "on"), CHECKED);
  assert.equal(cleanValue(refunded, ""), null);
  assert.equal(cleanValue({ name: "Note", kind: "text", options: [] }, "x".repeat(900))?.length, 500);
});

test("required fields must be filled before closing", () => {
  const defs = [
    { name: "Plan", requiredToClose: true },
    { name: "Order", requiredToClose: true },
    { name: "Note", requiredToClose: false },
  ];
  assert.deepEqual(missingRequired(defs, { Plan: "Pro", Order: " " }), ["Order"]);
  assert.deepEqual(missingRequired(defs, { Plan: "Pro", Order: "42" }), []);
  assert.equal(missingMessage(["Plan", "Order", "Reason"]), "Fill in Plan, Order and Reason before closing this ticket.");
});

if (process.env.DATABASE_URL) {
  after(async () => {
    const { db, schema, pool } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await pool.end();
  });

  test("database: imported values fill a field, renames carry values, closing waits on required fields", async () => {
    const { db, schema } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await db.insert(schema.orgs).values({ id: ORG, name: "Acme" });
    const { createTicket } = await import("./tickets");
    const { addField, blockedFromClosing, deleteField, listFields, setTicketValues, updateField } = await import("./ticket-fields");

    const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: "kim@example.com", customerName: "Kim", subject: "Upgrade", body: "Hi", authorType: "customer", fields: { "Imported from": "Zendesk #4", Plan: "Pro" } });
    const plan = await addField(ORG, parseFieldInput(form({ name: "Plan", kind: "dropdown", options: "Free, Pro", requiredToClose: "on" })));
    await addField(ORG, parseFieldInput(form({ name: "Refunded", kind: "checkbox" })));
    await assert.rejects(addField(ORG, parseFieldInput(form({ name: "Plan", kind: "text" }))), FieldError, "names are unique");
    assert.deepEqual((await listFields(ORG)).map((f) => f.name), ["Plan", "Refunded"]);

    assert.equal((await blockedFromClosing(ORG, [t.id])).size, 0, "the imported Plan counts");
    await updateField(ORG, plan.id, parseFieldInput(form({ name: "Plan tier", kind: "dropdown", options: "Free, Pro", requiredToClose: "on" })));
    let row = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, t.id) });
    assert.deepEqual(row?.fields, { "Imported from": "Zendesk #4", "Plan tier": "Pro" });

    // Saving the rail: a cleared dropdown and a ticked box. Values no field covers stay.
    await setTicketValues(ORG, t.id, (name) => ({ "Plan tier": "", Refunded: "on" })[name] ?? null);
    row = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, t.id) });
    assert.deepEqual(row?.fields, { "Imported from": "Zendesk #4", Refunded: CHECKED });
    assert.deepEqual((await blockedFromClosing(ORG, [t.id])).get(t.id), ["Plan tier"]);
    await assert.rejects(setTicketValues(ORG, t.id, (name) => (name === "Plan tier" ? "Gold" : null)), FieldError);

    // Deleting a field keeps what tickets already had.
    await deleteField(ORG, plan.id);
    await setTicketValues(ORG, t.id, () => null);
    row = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, t.id) });
    assert.deepEqual(row?.fields, { "Imported from": "Zendesk #4" }, "an unticked box clears");
    assert.equal((await blockedFromClosing(ORG, [t.id])).size, 0);

    const { searchTickets } = await import("./search");
    await db.update(schema.tickets).set({ fields: { "Order number": "AC-99812" } }).where(eq(schema.tickets.id, t.id));
    assert.deepEqual((await searchTickets(ORG, "AC-99812")).map((r) => r.id), [t.id]);
  });
}
