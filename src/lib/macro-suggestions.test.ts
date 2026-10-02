// AI macros, identification. The matching tests need no database; the
// last test does. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { answerPart, identifyMacro, macroBody, macroName, repeatsOf, suggestMacros, type Reply } from "./macro-suggestions";
import { cleanWritten, withAiDrafts, writeRoom, writerPrompt } from "./macro-writer";

const NOW = new Date("2026-09-28T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const REFUND = [
  "Hi Sarah,\n\nRefunds go back to the original card within 5 business days. You'll get an email from us as soon as it's on its way.\n\nThanks,\nAna",
  "Hello Tom,\nRefunds go back to your original card within 5 business days, and you'll get an email as soon as it's on the way.\n\nBest,\nSam",
  "Hi Priya,\n\nRefunds go back to the original card within 5 business days. We'll email you as soon as it's on its way.\n\nCheers,\nAna",
  "Hey Lee,\nRefunds always go back to the original card within 5 business days. You'll get an email from us once it's on its way.\n\nThanks!\nAna\n\nOn Mon, Sep 21, 2026 at 9:14 AM Lee <lee@x.com> wrote:\n> where is my refund for order 88213",
  "Hi Maria,\n\nRefunds go back to the original payment card within 5 business days. You'll get an email from us as soon as it's on its way.\n\nThanks,\nSam",
  "Hi Jo,\nRefunds go back to the original card within 5 business days. You'll get an email as soon as it's on its way.\nThanks,\nAna",
];

const OTHER = [
  "Hi Ana, I've reset your password. Use the link in the email we just sent; it lasts 30 minutes.",
  "Thanks for the report! I've passed the export bug to our engineers and will update you when it's fixed.",
  "Your plan renews on the 1st. You can switch to annual billing from Settings, Billing at any time.",
  "Thanks, closing this.",
];

function replies(): Reply[] {
  const out: Reply[] = REFUND.map((body, i) => ({ id: `r${i}`, ticketId: `t${i}`, ticketNumber: 100 + i, body, createdAt: hoursAgo(i * 30), tags: i === 2 ? ["vip"] : ["billing", "refund"] }));
  OTHER.forEach((body, i) => out.push({ id: `o${i}`, ticketId: `u${i}`, ticketNumber: 200 + i, body, createdAt: hoursAgo(i * 5), tags: [] }));
  return out;
}

test("cleans a reply down to the answer", () => {
  assert.equal(answerPart(REFUND[3]), "Refunds always go back to the original card within 5 business days. You'll get an email from us once it's on its way.");
});

test("finds an answer sent on 5 or more tickets and turns it into a macro", () => {
  const [s, ...rest] = suggestMacros(replies(), { now: NOW });
  assert.equal(rest.length, 0, "one-off replies are not suggested");
  assert.equal(s.tickets, 6);
  assert.equal(s.thisWeek, 6);
  assert.deepEqual(s.addTags, ["billing", "refund"], "tags on at least 60% of the tickets");
  assert.match(s.body, /^(Hi|Hello|Hey) there,/, "the customer's name is removed");
  assert.doesNotMatch(s.body, /\n(Ana|Sam)$/, "the agent's name under the sign-off is removed");
  assert.doesNotMatch(s.body, /wrote:/);
  assert.equal(s.name, "Refunds go back to the original card");
  assert.equal(s.examples.length, 5);
});

test("needs 5 different tickets, not 5 replies on one ticket", () => {
  const same = REFUND.map((body, i) => ({ id: `r${i}`, ticketId: i < 3 ? "t1" : "t2", ticketNumber: 1, body, createdAt: hoursAgo(i) }));
  assert.equal(suggestMacros(same, { now: NOW }).length, 0);
});

test("skips answers that are already a macro or were dismissed", () => {
  const macro = "Hi {first name}, refunds go back to the original card within 5 business days. You'll get an email as soon as it's on its way.";
  assert.equal(suggestMacros(replies(), { now: NOW, covered: [macro] }).length, 0);
  assert.equal(repeatsOf(REFUND[0], replies(), { covered: [macro] }), 0);
});

test("counts how often an agent has already sent the reply they just wrote", () => {
  const others = replies().filter((r) => r.id !== "r0");
  assert.equal(repeatsOf(REFUND[0], others), 5);
  assert.equal(repeatsOf(OTHER[1], others), 1);
  assert.equal(repeatsOf("Thanks, closing this.", others), 0, "too short to be worth a macro");
});

test("placeholders replace order numbers and emails", () => {
  assert.equal(
    macroBody("Hi Kim,\nOrder 88213 for $1,250.00 shipped. We sent tracking to kim@acme.com.\nThanks,\nAna"),
    "Hi there,\nOrder [number] for [number] shipped. We sent tracking to [email].\nThanks,",
  );
  assert.equal(macroName("Your plan renews on the 1st. You can switch any time."), "Your plan renews on the 1st");
});

test("identifies the macro that answers a customer's message", () => {
  const macros = [
    { id: "refund", name: "Refund timing", question: "When will my refund arrive on my card?" },
    { id: "reset", name: "Reset password", question: "How do I reset my password?" },
    { id: "plain", name: "Shipping to Canada", question: null },
  ];
  assert.equal(identifyMacro("Hi, I returned the shoes last week. When will the refund arrive on my card?\nThanks, Kim", macros)?.id, "refund");
  assert.equal(identifyMacro("I can't log in, how do I reset my password?", macros)?.id, "reset");
  assert.equal(identifyMacro("Do you do shipping to Canada?", macros)?.id, "plain", "falls back to the macro name");
  assert.equal(identifyMacro("Can I change the color of my order?", macros), null, "nothing close enough");
  assert.equal(identifyMacro("Thanks!", macros), null);
});

test("the AI macro writer reads one variant per ticket and tidies what comes back", () => {
  const [s] = suggestMacros(replies(), { now: NOW });
  assert.equal(s.samples.length, 6, "one sample per ticket");
  assert.equal(s.aiWritten, false);
  const prompt = writerPrompt(s.samples);
  assert.match(prompt, /<reply n="1"/);
  assert.ok(!prompt.includes("Lee <lee@x.com> wrote"), "quoted email left out");
  assert.deepEqual(cleanWritten({ name: "  **Refund** timing ", question: "When does my refund arrive?", body: "Hi [customer name],\n**Refunds** take 5 days.\nThanks," }), {
    name: "Refund timing",
    question: "When does my refund arrive?",
    body: "Hi [customer name],\nRefunds take 5 days.\nThanks,",
  });
  assert.equal(cleanWritten({ name: "x", question: "", body: "y" }), null);
});

after(async () => {
  const { pool } = await import("@/db");
  await pool.end();
});

test("database: suggestions come from sent replies, and saving or dismissing one removes it", { skip: !process.env.DATABASE_URL }, async () => {
  const { db, schema } = await import("@/db");
  const { createTicket, addReply } = await import("./tickets");
  const { macroSuggestions, dismissSuggestion, saveSuggestedMacro, repeatPrompt } = await import("./macro-suggestions");
  const ORG = "org_test_macro_suggestions";

  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Suggestions team" });
  await db.insert(schema.agents).values({ orgId: ORG, userId: "u1", name: "Ana", email: "ana@acme.com", role: "admin" });

  let last = { ticketId: "", reply: { id: "", body: "", createdAt: new Date() } };
  for (const [i, body] of REFUND.entries()) {
    const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: `c${i}@x.com`, subject: "Where is my refund?", body: "Refund?", authorType: "customer" });
    const { messageId } = await addReply({ orgId: ORG, ticketId: t.id, userId: "u1", body, internal: false });
    last = { ticketId: t.id, reply: { id: messageId!, body, createdAt: new Date() } };
  }
  // Internal notes are never suggested.
  const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: "n@x.com", subject: "Note", body: "?", authorType: "customer" });
  for (let i = 0; i < 6; i++) await addReply({ orgId: ORG, ticketId: t.id, userId: "u1", body: `Escalating this to finance for review, they own refunds over the limit ${i}.`, internal: true });

  const [s, ...rest] = await macroSuggestions(ORG);
  assert.equal(rest.length, 0);
  assert.equal(s.tickets, 6);

  const prompt = await repeatPrompt(ORG, last.ticketId, last.reply);
  assert.equal(prompt?.tickets, 6);
  assert.equal(await repeatPrompt(ORG, last.ticketId, { ...last.reply, createdAt: new Date(Date.now() - 2 * 3_600_000) }), null, "only right after replying");

  await dismissSuggestion(ORG, "u1", s.answer);
  assert.equal((await macroSuggestions(ORG)).length, 0, "dismissed");
  await db.delete(schema.macroSuggestionDismissals).where(eq(schema.macroSuggestionDismissals.orgId, ORG));
  assert.equal((await macroSuggestions(ORG)).length, 1);

  // The AI's write-up replaces the plain version once it exists.
  await db.insert(schema.macroAiDrafts).values({ orgId: ORG, key: s.key, name: "Refund timing", question: "When will my refund arrive?", body: "Hi [customer name],\nRefunds take 5 business days.", model: "test" });
  const { suggestions: [written], missing } = await withAiDrafts(ORG, await macroSuggestions(ORG));
  assert.equal(missing.length, 0);
  assert.equal(written.name, "Refund timing");
  assert.equal(written.aiWritten, true);

  await saveSuggestedMacro(ORG, { name: written.name, body: written.body, addTags: s.addTags, question: written.question }, { answer: s.answer, userId: "u1" });
  const [saved] = await db.select().from(schema.macros).where(eq(schema.macros.orgId, ORG));
  assert.equal(saved.question, "When will my refund arrive?");
  assert.equal(saved.source, "suggested");
  assert.equal((await macroSuggestions(ORG)).length, 0, "saved as a macro");
  assert.equal(await repeatPrompt(ORG, last.ticketId, last.reply), null);

  // Nothing here is an AI call, so the allowance is untouched.
  assert.equal((await db.select().from(schema.aiEvents).where(eq(schema.aiEvents.orgId, ORG))).length, 0);
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
});

test("macro writing stops at the daily count or the monthly per-seat spend", () => {
  assert.equal(writeRoom({ writtenToday: 0, spentThisMonth: 0, seats: 1 }), 3);
  assert.equal(writeRoom({ writtenToday: 11, spentThisMonth: 0, seats: 1 }), 1);
  assert.equal(writeRoom({ writtenToday: 12, spentThisMonth: 0, seats: 1 }), 0);
  assert.equal(writeRoom({ writtenToday: 0, spentThisMonth: 1.99, seats: 1 }), 3);
  assert.equal(writeRoom({ writtenToday: 0, spentThisMonth: 2, seats: 1 }), 0);
  assert.equal(writeRoom({ writtenToday: 0, spentThisMonth: 2, seats: 0 }), 0);
  assert.equal(writeRoom({ writtenToday: 0, spentThisMonth: 9, seats: 5 }), 3);
});
