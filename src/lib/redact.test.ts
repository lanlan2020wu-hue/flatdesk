// Card numbers and verified chat identity. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { cleanAttributes, identityFields, userHash, VERIFIED_FIELD, verifyUserHash } from "./chat-identity";
import { luhn, maskCards } from "./redact";

test("card numbers that pass the checksum are masked, keeping the last four", () => {
  assert.ok(luhn("4242424242424242"));
  assert.equal(maskCards("My card is 4242 4242 4242 4242, exp 12/28"), "My card is [card number removed, ending 4242], exp 12/28");
  assert.equal(maskCards("amex 3782-822463-10005 please"), "amex [card number removed, ending 0005] please");
  assert.equal(maskCards("5555555555554444"), "[card number removed, ending 4444]");
});

test("other long numbers are left alone", () => {
  for (const text of ["Order 4242424242424241", "Call +1 415 555 0132", "Invoice 2026-10-06-0001", "0000000000000000", "1234567890123", "tracking 9400111899223817428490"]) {
    assert.equal(maskCards(text), text);
  }
});

test("chat identity: a matching hash is verified and keeps attributes; a wrong one says so", () => {
  const secret = "s3cret";
  const hash = userHash(secret, "Ana@BigFirm.com");
  assert.ok(verifyUserHash(secret, "ana@bigfirm.com", hash));
  assert.ok(!verifyUserHash(secret, "eve@bigfirm.com", hash));
  assert.ok(!verifyUserHash(secret, "ana@bigfirm.com", "nothex"));
  assert.deepEqual(identityFields(secret, "ana@bigfirm.com", hash, JSON.stringify({ Plan: "Pro", Seats: 12, nested: { x: 1 } })), {
    [VERIFIED_FIELD]: "Yes, as ana@bigfirm.com",
    Plan: "Pro",
    Seats: "12",
  });
  const bad = identityFields(secret, "eve@bigfirm.com", hash, { Plan: "Enterprise" });
  assert.deepEqual(Object.keys(bad), [VERIFIED_FIELD]);
  assert.match(bad[VERIFIED_FIELD], /^No/);
  assert.deepEqual(identityFields(secret, "x@y.com", undefined, { Plan: "x" }), {});
  assert.equal(Object.keys(cleanAttributes(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i])))).length, 10);
});

const ORG = "org_redact_test";

test("database: a chat with a card number and a signed-in visitor", { skip: !process.env.DATABASE_URL }, async () => {
  const { db, schema, pool } = await import("@/db");
  after(() => pool.end());
  const { startConversation } = await import("./chat");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  const [org] = await db.insert(schema.orgs).values({ id: ORG, name: "Redact team", inboundKey: "redact001" }).returning();
  assert.match(org.chatSecret, /^[0-9a-f]{64}$/);

  const { ticket } = await startConversation(
    ORG,
    { email: "ana@bigfirm.com", name: "Ana", message: "Charge 4111 1111 1111 1111 again", userHash: userHash(org.chatSecret, "ana@bigfirm.com"), attributes: '{"Plan":"Pro"}' },
    [],
    org.chatSecret,
  );
  const saved = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, ticket.id) });
  assert.deepEqual(saved?.fields, { [VERIFIED_FIELD]: "Yes, as ana@bigfirm.com", Plan: "Pro" });
  assert.equal(saved?.subject, "Charge [card number removed, ending 1111] again");
  const [m] = await db.select().from(schema.messages).where(eq(schema.messages.ticketId, ticket.id));
  assert.ok(!m.body.includes("4111 1111"));
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
});
