// The AI learning from solved tickets. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { checkChanges, learnPrompt, LEARN, ticketText, type KnownAnswer, type LearnTicket } from "./learn";

const ORG = "org_learn_ai";
const known: KnownAnswer[] = [
  { id: "m-team", name: "Shipping times", question: "How long does shipping take?", body: "Hi [customer name], we ship in 2 days.", learned: false },
  { id: "m-learned", name: "Refund timing", question: "When do I get my refund?", body: "Hi [customer name], refunds take 5 business days.", learned: true },
];
const list: LearnTicket[] = [
  { id: "t1", number: 1, subject: "Refund?", handedOff: true, thread: [{ from: "customer", body: "When is my refund?" }, { from: "agent", body: "Refunds now take 7 business days." }] },
  { id: "t2", number: 2, subject: "Gift wrap", handedOff: false, thread: [{ from: "customer", body: "Do you gift wrap?" }, { from: "agent", body: "Yes, for $3 at checkout." }] },
];
const change = (c: Partial<{ action: "add" | "update" | "retire" | "flag"; answer: string; tickets: string[]; title: string; question: string; body: string; why: string }>) => ({
  action: "add" as const,
  answer: "",
  tickets: ["T1"],
  title: "",
  question: "",
  body: "",
  why: "Because.",
  ...c,
});

test("the prompt marks learned answers and handoffs, and leaves out what's too long", () => {
  const p = learnPrompt(known, ["Old promo"], list);
  assert.match(p, /<answer ref="S2" title="Refund timing" learned="true">/);
  assert.doesNotMatch(p, /<answer ref="S1"[^>]*learned/);
  assert.match(p, /<ticket ref="T1" subject="Refund\?" ai_handed_off="true">/);
  assert.match(p, /removed_by_team>\n- Old promo/);
  assert.match(p, /Team: Refunds now take 7/);
  // Card numbers never reach the model.
  const card = ticketText({ ...list[0], thread: [{ from: "customer", body: "card 4242 4242 4242 4242" }] }, 1);
  assert.doesNotMatch(card, /4242 4242 4242 4242/);
  // A long ticket keeps its newest messages.
  const long = ticketText({ ...list[0], thread: [{ from: "customer", body: "first" }, ...Array.from({ length: 10 }, () => ({ from: "agent" as const, body: "x".repeat(1000) })), { from: "agent", body: "the latest" }] }, 1);
  assert.match(long, /the latest/);
  assert.doesNotMatch(long, /first/);
  assert.ok(long.length < LEARN.ticketChars + 500);
});

test("changes are checked: refs exist, only learned answers change, team macros are only flagged", () => {
  const out = {
    changes: [
      change({ action: "add", title: "Gift wrapping", question: "Do you gift wrap?", body: "Hi [customer name], yes, for $3.", tickets: ["T2"] }),
      change({ action: "add", title: "Shipping  times", body: "dup", tickets: ["T2"] }), // already covered
      change({ action: "add", title: "Old promo", body: "removed by the team", tickets: ["T2"] }),
      change({ action: "add", title: "No ticket", body: "x", tickets: ["T9"] }), // made-up ref
      change({ action: "update", answer: "S2", title: "Refund timing", body: "Hi [customer name], refunds take 7 business days.", tickets: ["T1"] }),
      change({ action: "retire", answer: "S2", tickets: ["T1"] }), // same answer twice
      change({ action: "update", answer: "S1", body: "Rewrite the team's macro", tickets: ["T1"] }), // never
      change({ action: "flag", answer: "S1", tickets: ["T1"] }),
      change({ action: "retire", answer: "S7", tickets: ["T1"] }),
    ],
  };
  const got = checkChanges(out, known, ["Old promo"], list);
  assert.deepEqual(
    got.map((c) => [c.action, "target" in c ? c.target.id : c.title, c.ticketIds.join()]),
    [
      ["add", "Gift wrapping", "t2"],
      ["update", "m-learned", "t1"],
      ["flag", "m-team", "t1"],
    ],
  );
  // At most LEARN.maxChanges are kept.
  const many = { changes: Array.from({ length: 9 }, (_, i) => change({ title: `Answer ${i}`, body: "b", tickets: ["T1"] })) };
  assert.equal(checkChanges(many, known, [], list).length, LEARN.maxChanges);
});

test("database: solved tickets become saved answers the AI reads, and keep current", { skip: !process.env.DATABASE_URL }, async () => {
  const { db, schema, pool } = await import("@/db");
  after(() => pool.end());
  const { eq } = await import("drizzle-orm");
  const { applyChanges, knownAnswers, learnCandidates, learnForOrg, recentLearning, rememberRemoved, retireStale, LEARNED_SOURCE } = await import("./learn");
  const { loadKnowledge } = await import("./ai");
  const { createTicket } = await import("./tickets");
  const { TAUGHT_PREFIX } = await import("./teach");

  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Learn team", inboundKey: "learn0001" });
  const solved = async (subject: string, reply: string, opts: { handoff?: boolean; closed?: boolean; internal?: boolean } = {}) => {
    const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: `${subject.length}@example.com`, subject, body: `${subject}?`, authorType: "customer" });
    await db.insert(schema.messages).values({ orgId: ORG, ticketId: t.id, authorType: "agent", authorId: "user_1", body: reply, internal: Boolean(opts.internal) });
    if (opts.handoff) await db.insert(schema.aiEvents).values({ orgId: ORG, ticketId: t.id, kind: "handoff", month: "2026-10", model: "m" });
    if (opts.closed !== false) await db.update(schema.tickets).set({ status: "closed", closedAt: new Date() }).where(eq(schema.tickets.id, t.id));
    return t;
  };
  const wrap = await solved("Gift wrap", "Yes, gift wrap is $3 at checkout.");
  const refund = await solved("Refund timing", "Refunds take 7 business days.", { handoff: true });
  await solved("Still open", "Looking into it.", { closed: false });
  await solved("Only a note", "internal only", { internal: true });

  // Handoffs first; open tickets and tickets with only internal notes are left out.
  const found = await learnCandidates(ORG);
  assert.deepEqual(found.map((t) => t.subject), ["Refund timing", "Gift wrap"]);
  assert.equal(found[0].handedOff, true);
  assert.deepEqual(found[0].thread.map((m) => m.from), ["customer", "agent"]);

  // An added answer is a macro the AI reads, with a note on the ticket it came from.
  await applyChanges(ORG, [{ action: "add", title: "Gift wrapping", question: "Do you gift wrap?", body: "Hi [customer name], yes, $3 at checkout.", why: "Asked and answered.", ticketIds: [wrap.id] }]);
  const k1 = await knownAnswers(ORG);
  assert.equal(k1.length, 1);
  assert.equal(k1[0].learned, true);
  assert.ok((await loadKnowledge(ORG)).some((k) => k.name === "Gift wrapping"));
  const notes = await db.select().from(schema.messages).where(eq(schema.messages.ticketId, wrap.id));
  assert.ok(notes.some((m) => m.internal && m.body.startsWith(TAUGHT_PREFIX)));
  // ... so that ticket isn't read again.
  assert.deepEqual((await learnCandidates(ORG)).map((t) => t.subject), ["Refund timing"]);

  // Updates touch learned answers only.
  const [team] = await db.insert(schema.macros).values({ orgId: ORG, name: "Team macro", body: "Ours." }).returning();
  await applyChanges(ORG, [
    { action: "update", target: k1[0], title: "Gift wrapping", question: "Do you gift wrap?", body: "Hi [customer name], yes, $4 at checkout.", why: "Price changed.", ticketIds: [refund.id] },
    { action: "update", target: { id: team.id, name: team.name, question: null, body: team.body, learned: true }, title: "x", question: "", body: "Changed!", why: "", ticketIds: [refund.id] },
    { action: "flag", target: { id: team.id, name: team.name, question: null, body: team.body, learned: false }, why: "Says 2 days; the team now says 3.", ticketIds: [refund.id] },
  ]);
  const [wrapNow] = await db.select().from(schema.macros).where(eq(schema.macros.id, k1[0].id));
  assert.match(wrapNow.body, /\$4/);
  const [teamNow] = await db.select().from(schema.macros).where(eq(schema.macros.id, team.id));
  assert.equal(teamNow.body, "Ours.");
  const log = await recentLearning(ORG);
  assert.deepEqual(log.map((r) => r.kind).sort(), ["added", "flagged", "updated"]);

  // Learned answers nobody uses are retired; recently changed ones aren't.
  const old = new Date(Date.now() - (LEARN.staleDays + 5) * 86_400_000);
  const [stale] = await db.insert(schema.macros).values({ orgId: ORG, name: "Summer sale", body: "20% off.", source: LEARNED_SOURCE, createdAt: old }).returning();
  await db.update(schema.macros).set({ createdAt: old }).where(eq(schema.macros.id, k1[0].id));
  assert.equal(await retireStale(ORG), 1);
  const left = await knownAnswers(ORG);
  assert.ok(!left.some((k) => k.id === stale.id));
  assert.ok(left.some((k) => k.id === k1[0].id));

  // A learned answer the team deletes is remembered.
  await rememberRemoved(ORG, { id: k1[0].id, name: "Gift wrapping", source: LEARNED_SOURCE });
  await rememberRemoved(ORG, { id: team.id, name: "Team macro", source: null });
  const removed = await db.select().from(schema.aiLearning).where(eq(schema.aiLearning.kind, "removed"));
  assert.deepEqual(removed.filter((r) => r.orgId === ORG).map((r) => r.name), ["Gift wrapping"]);

  // Turned off, nothing runs.
  await db.update(schema.orgs).set({ aiAutoLearn: false }).where(eq(schema.orgs.id, ORG));
  assert.equal(await learnForOrg(ORG), "off");

  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
});
