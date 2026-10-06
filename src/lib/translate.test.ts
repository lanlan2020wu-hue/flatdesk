// Auto-translate: which messages need it, and what's kept. Model calls aren't
// made here. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { guessLanguage, isForeign } from "./language";

test("the language guess is free and only says something when it's clear", () => {
  assert.equal(guessLanguage("Hi, my order hasn't arrived yet. Can you help please?"), "en");
  assert.equal(guessLanguage("Hola, mi pedido no ha llegado todavía. ¿Me pueden ayudar?"), "es");
  assert.equal(guessLanguage("Bonjour, ma commande n'est pas arrivée. Pouvez-vous m'aider ?"), "fr");
  assert.equal(guessLanguage("Hallo, meine Bestellung ist noch nicht da. Können Sie mir bitte helfen?"), "de");
  assert.equal(guessLanguage("注文がまだ届いていません。"), "ja");
  assert.equal(guessLanguage("我的订单还没有到。"), "zh");
  assert.equal(guessLanguage("Здравствуйте, мой заказ ещё не пришёл."), "ru");
  assert.equal(guessLanguage("thanks!"), null, "too short to tell");
  assert.equal(guessLanguage("Thanks\n\n> Hola, mi pedido no ha llegado todavía"), null, "quoted history is ignored");
  assert.equal(isForeign("Hola, mi pedido no ha llegado todavía. ¿Me pueden ayudar?", "en"), "es");
  assert.equal(isForeign("Hola, mi pedido no ha llegado todavía. ¿Me pueden ayudar?", "es"), null, "a Spanish team reads Spanish");
});

after(async () => {
  const { pool } = await import("@/db");
  await pool.end();
});

test("database: only foreign customer messages need translating, and a translated reply keeps what the agent wrote", { skip: !process.env.DATABASE_URL }, async () => {
  const ORG = "org_test_translate";
  const { db, schema } = await import("@/db");
  const { createTicket, addReply, addCustomerMessage } = await import("./tickets");
  const { translateTicket } = await import("./copilot");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Acme", aiEnabled: false, billedSeats: 1, subscriptionStatus: "active" });
  await db.insert(schema.agents).values({ orgId: ORG, userId: "u1", name: "Ana", email: "ana@acme.test", role: "admin" });

  const key = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: "kim@x.com", subject: "Late", body: "Hi, my order hasn't arrived yet. Can you help please?", authorType: "customer" });
    assert.equal(await translateTicket(ORG, "u1", t.id), 0, "English for an English team: nothing to do, no AI call");
    const [customer] = await db.select().from(schema.customers).where(eq(schema.customers.orgId, ORG));
    await addCustomerMessage({ orgId: ORG, ticketId: t.id, customerId: customer.id, body: "Hola, mi pedido no ha llegado todavía. ¿Me pueden ayudar?" });
    await assert.rejects(translateTicket(ORG, "u1", t.id), /isn't set up/, "a Spanish message needs the AI");

    const r = await addReply({ orgId: ORG, ticketId: t.id, userId: "u1", body: "Lo siento, lo reviso ahora.", original: "Sorry, checking now.", internal: false });
    const n = await addReply({ orgId: ORG, ticketId: t.id, userId: "u1", body: "note", original: "ignored", internal: true });
    const [sent] = await db.select().from(schema.messages).where(eq(schema.messages.id, r.messageId!));
    const [note] = await db.select().from(schema.messages).where(eq(schema.messages.id, n.messageId!));
    assert.equal(sent.body, "Lo siento, lo reviso ahora.");
    assert.equal(sent.original, "Sorry, checking now.");
    assert.equal(note.original, null, "notes are never translated");
  } finally {
    if (key) process.env.ANTHROPIC_API_KEY = key;
  }
});
