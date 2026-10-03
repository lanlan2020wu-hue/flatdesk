// Teaching the AI from a handoff note. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { HANDOFF_PREFIX, TAUGHT_PREFIX, teachSpot } from "./teach";

const ORG = "org_teach_ai";
const sys = (body: string) => ({ authorType: "system", internal: true, body });
const customer = { authorType: "customer", internal: false, body: "How do I reset my password?" };

test("the box sits under the latest handoff note until someone teaches the AI", () => {
  assert.equal(teachSpot([customer]), -1);
  assert.equal(teachSpot([customer, sys(`${HANDOFF_PREFIX} not covered.`)]), 1);
  assert.equal(teachSpot([customer, sys(`${HANDOFF_PREFIX} a.`), customer, sys(`${HANDOFF_PREFIX} b.`)]), 3);
  assert.equal(teachSpot([customer, sys(`${HANDOFF_PREFIX} a.`), sys(`${TAUGHT_PREFIX} Ana saved it.`)]), -1);
  // A newer handoff after a lesson brings the box back.
  assert.equal(teachSpot([customer, sys(`${HANDOFF_PREFIX} a.`), sys(`${TAUGHT_PREFIX} x`), customer, sys(`${HANDOFF_PREFIX} b.`)]), 4);
  // Other system notes don't count.
  assert.equal(teachSpot([customer, sys("AI didn't answer because of an internal error.")]), -1);
});

test("database: a lesson becomes a saved answer the AI reads", { skip: !process.env.DATABASE_URL }, async () => {
  const { db, schema, pool } = await import("@/db");
  after(() => pool.end());
  const { teachAi, TeachError } = await import("./teach");
  const { loadKnowledge } = await import("./ai");
  const { createTicket } = await import("./tickets");

  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.delete(schema.orgs).where(eq(schema.orgs.id, `${ORG}_other`));
  await db.insert(schema.orgs).values([
    { id: ORG, name: "Teach team", inboundKey: "teach0001" },
    { id: `${ORG}_other`, name: "Other team", inboundKey: "teach0002" },
  ]);
  const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: "sam@example.com", subject: "Password reset", body: "The login page isn't helping.", authorType: "customer" });

  await assert.rejects(teachAi({ orgId: ORG, ticketId: t.id, agentName: "Ana", question: "Password reset", answer: " " }), TeachError);
  // Another team's ticket is out of reach.
  await assert.rejects(teachAi({ orgId: `${ORG}_other`, ticketId: t.id, agentName: "Eve", question: "x", answer: "y" }), TeachError);

  const { macro } = await teachAi({ orgId: ORG, ticketId: t.id, agentName: "Ana", question: "Password reset", answer: "Click Forgot password on the sign-in page." });
  assert.equal(macro.source, "taught");
  assert.equal(macro.internal, false);
  const knowledge = await loadKnowledge(ORG);
  assert.ok(knowledge.some((k) => k.name === "Password reset" && k.body.includes("Forgot password")));

  const notes = await db.select().from(schema.messages).where(eq(schema.messages.ticketId, t.id));
  const taught = notes.find((m) => m.body.startsWith(TAUGHT_PREFIX));
  assert.ok(taught?.internal, "the lesson is an internal note");
  assert.equal(teachSpot(notes.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())), -1);

  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.delete(schema.orgs).where(eq(schema.orgs.id, `${ORG}_other`));
});
