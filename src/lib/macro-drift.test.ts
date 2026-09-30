// Macros that fix themselves: spotting the edit a team keeps making to a
// macro before sending it. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { DRIFT, applyDrift, diffUse, macroDrift, sentences } from "./macro-drift";

const MACRO = "Hi [customer name],\n\nRefunds go back to the original card within 5 business days. You'll get an email when it's on its way.\n\nThanks,";
const send = (name: string, middle: string, sign = "Sam") => `Hi ${name},\n\n${middle}\n\nThanks,\n${sign}`;

test("sentences split on lines and sentence ends", () => {
  assert.deepEqual(sentences("One. Two!\nThree? four"), ["One.", "Two!", "Three? four"]);
});

test("a send that only fills in placeholders and signs off has no edits", () => {
  const d = diffUse(MACRO, send("Kim", "Refunds go back to the original card within 5 business days. You'll get an email when it's on its way."));
  assert.deepEqual(d, { removed: [], changed: [], added: [] });
});

test("one send's edits: a changed time frame, a deleted line and a new line", () => {
  const d = diffUse(MACRO, send("Kim", "Refunds go back to the original card within 7 business days. If it hasn't arrived by then, reply with your order number."));
  assert.deepEqual(d.changed.map((c) => c.to), ["Refunds go back to the original card within 7 business days."]);
  assert.deepEqual(d.removed, [1]);
  assert.deepEqual(d.added.map((a) => a.text), ["If it hasn't arrived by then, reply with your order number."]);
});

test("the same edit on most sends is drift; a one-off isn't", () => {
  const edited = (n: string) => send(n, "Refunds go back to the original card within 7 business days. You'll get an email when it's on its way. Your bank may take 2 more days to show it.");
  const plain = (n: string) => send(n, "Refunds go back to the original card within 5 business days. You'll get an email when it's on its way.");
  const drift = macroDrift(MACRO, [edited("Kim"), edited("Lee"), plain("Ana"), edited("Jo")])!;
  assert.equal(drift.uses, 4);
  assert.deepEqual(drift.changed.map((c) => [c.to, c.count]), [["Refunds go back to the original card within 7 business days.", 3]]);
  assert.deepEqual(drift.added.map((a) => [a.text, a.count]), [["Your bank may take 2 more days to show it.", 3]]);
  assert.equal(drift.removed.length, 0);
  assert.match(drift.signature, /^[0-9a-f]{16}$/);

  assert.equal(macroDrift(MACRO, [edited("Kim"), plain("Lee"), plain("Ana"), plain("Jo")]), null, "one edited send out of four");
  assert.equal(macroDrift(MACRO, [edited("Kim"), edited("Lee")]), null, `fewer than ${DRIFT.minUses} sends`);
});

test("the same edit gives the same signature, whoever sent it", () => {
  const e = (n: string) => send(n, "Refunds go back to the original card within 5 business days. You'll get an email when it's on its way. Your bank may take 2 more days to show it.");
  assert.equal(macroDrift(MACRO, [e("Kim"), e("Lee"), e("Jo")])!.signature, macroDrift(MACRO, [e("Ana"), e("Max"), e("Sol")])!.signature);
});

test("applying the drift keeps placeholders and the greeting, and places new lines", () => {
  const e = (n: string) => send(n, "Refunds go back to the original card within 7 business days. Your bank may take 2 more days to show it.");
  const drift = macroDrift(MACRO, [e("Kim"), e("Lee"), e("Jo")])!;
  assert.deepEqual(drift.removed.map((r) => r.text), ["You'll get an email when it's on its way."]);
  assert.equal(
    applyDrift(MACRO, drift),
    "Hi [customer name],\n\nRefunds go back to the original card within 7 business days. Your bank may take 2 more days to show it.\n\nThanks,",
  );
});

after(async () => {
  const { pool } = await import("@/db");
  await pool.end();
});

test("database: uses of the current text count, and a dismissed edit isn't proposed again", { skip: !process.env.DATABASE_URL }, async () => {
  const { db, schema } = await import("@/db");
  const { createTicket, addReply } = await import("./tickets");
  const { macroUpdates, recordMacroUses } = await import("./macro-drift");
  const ORG = "org_test_macro_drift";

  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Drift team" });
  await db.insert(schema.agents).values({ orgId: ORG, userId: "u1", name: "Sam", email: "sam@x.com", role: "admin" });
  const [macro] = await db.insert(schema.macros).values({ orgId: ORG, name: "Refund timing", body: MACRO }).returning();

  const edited = "Refunds go back to the original card within 5 business days. You'll get an email when it's on its way. Your bank may take 2 more days to show it.";
  for (const n of ["Kim", "Lee", "Jo"]) {
    const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: `${n.toLowerCase()}@x.com`, subject: "Refund?", body: "When is my refund?", authorType: "customer" });
    const r = await addReply({ orgId: ORG, ticketId: t.id, userId: "u1", body: send(n, edited), internal: false });
    await recordMacroUses(ORG, r.messageId!, [macro.id, "not-a-uuid"]);
  }
  const [update] = await macroUpdates(ORG);
  assert.equal(update.macro.id, macro.id);
  assert.deepEqual(update.drift.added.map((a) => a.text), ["Your bank may take 2 more days to show it."]);

  // Once the macro changes, earlier sends no longer count.
  await db.update(schema.macros).set({ body: applyDrift(MACRO, update.drift) }).where(eq(schema.macros.id, macro.id));
  assert.deepEqual(await macroUpdates(ORG), []);

  // Put it back, then dismiss the edit: it stays dismissed.
  await db.update(schema.macros).set({ body: MACRO }).where(eq(schema.macros.id, macro.id));
  await db.insert(schema.macroUpdateDismissals).values({ orgId: ORG, macroId: macro.id, signature: update.drift.signature });
  assert.deepEqual(await macroUpdates(ORG), []);

  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
});
