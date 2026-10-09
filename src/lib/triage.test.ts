// AI triage of new tickets. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { decide, describeTriage, TRIAGE, triagePrompt, type TriageOutput } from "./triage";

const ORG = "org_test_triage";
const out = (o: Partial<TriageOutput>): TriageOutput => ({ priority: "normal", tags: [], group: "", reason: "Charged twice.", ...o });
const groups = [
  { id: "g-billing", name: "Billing" },
  { id: "g-tier2", name: "Tier 2" },
];

test("the prompt lists the team's tags and groups, and masks card numbers", () => {
  const p = triagePrompt({
    subject: 'Refund "now"',
    body: "My card 4242 4242 4242 4242 was charged twice",
    channel: "email",
    customer: "Kim",
    knownTags: ["billing", "refund"],
    groups: ["Billing"],
    instructions: "",
  });
  assert.match(p, /<team_tags>\nbilling, refund\n<\/team_tags>/);
  assert.match(p, /<groups>\nBilling\n<\/groups>/);
  assert.match(p, /subject="Refund 'now'"/);
  assert.doesNotMatch(p, /4242 4242 4242 4242/);
  assert.doesNotMatch(p, /what_the_team_told_the_ai/);
  assert.match(triagePrompt({ subject: "", body: "x".repeat(TRIAGE.bodyChars + 500), channel: "chat", customer: "", knownTags: [], groups: [], instructions: "" }), /\(none yet\)/);
});

test("triage only fills in what nobody set, and never makes up tags or groups", () => {
  const fresh = { priority: "normal" as const, tags: [], groupId: null };
  assert.deepEqual(decide(fresh, out({ priority: "urgent", tags: ["Billing", "made-up", "refund", "refund"], group: "billing" }), ["billing", "refund"], groups), {
    priority: "urgent",
    tags: ["billing", "refund"],
    groupId: "g-billing",
  });
  // A priority someone (or a trigger) set stays; so does the group; tags already on aren't added twice.
  assert.deepEqual(decide({ priority: "low", tags: ["billing"], groupId: "g-tier2" }, out({ priority: "high", tags: ["billing"], group: "Billing" }), ["billing"], groups), {});
  // An unknown group is ignored; at most TRIAGE.maxTags tags.
  const many = decide(fresh, out({ tags: ["a", "b", "c", "d"], group: "Sales" }), ["a", "b", "c", "d"], groups);
  assert.equal(many.tags?.length, TRIAGE.maxTags);
  assert.equal(many.groupId, undefined);
  assert.equal(many.priority, undefined);
});

test("the note says what changed and why", () => {
  const note = describeTriage({ priority: "high", tags: ["billing"], groupId: "g-billing" }, "Charged twice and upset.", () => "Billing");
  assert.equal(note, "AI triage: priority High; tagged billing; put in Billing. Why: Charged twice and upset. Change any of it on the ticket.");
  assert.equal(describeTriage({}, "Nothing.", () => ""), null);
});

if (process.env.DATABASE_URL) {
  after(async () => {
    const { db, schema, pool } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await pool.end();
  });

  test("database: a ticket is triaged once, and a person's changes win", async () => {
    const { db, schema } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await db.insert(schema.orgs).values({ id: ORG, name: "Acme", aiEnabled: false });
    await db.insert(schema.agents).values({ orgId: ORG, userId: "user_ada", name: "Ada", email: "ada@acme.test", role: "admin" });
    const [billing] = await db.insert(schema.groups).values({ orgId: ORG, name: "Billing" }).returning();
    const { createTicket } = await import("./tickets");
    const { applyTriage, claimTriage, triageUsage } = await import("./triage");

    const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: "kim@example.com", customerName: "Kim", subject: "Charged twice", body: "Please refund", authorType: "customer" });
    assert.ok(await claimTriage(ORG, t.id));
    assert.equal(await claimTriage(ORG, t.id), null, "one triage per ticket");
    assert.equal((await triageUsage(ORG)).used, 1);

    const applied = await applyTriage(ORG, t.id, out({ priority: "high", tags: ["billing", "invented"], group: "Billing" }), ["billing"], [billing]);
    assert.deepEqual(applied, { priority: "high", tags: ["billing"], groupId: billing.id });
    const ticket = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, t.id) });
    assert.equal(ticket?.priority, "high");
    // Other test files' jobs (the overdue sweep) can tag it meanwhile, so only these two matter.
    assert.ok(ticket?.tags.includes("billing") && !ticket.tags.includes("invented"));
    assert.equal(ticket?.groupId, billing.id);
    const notes = await db.select().from(schema.messages).where(eq(schema.messages.ticketId, t.id));
    assert.ok(notes.some((m) => m.authorType === "system" && m.internal && m.body.startsWith("AI triage: priority High; tagged billing; put in Billing.")));

    // Someone set it to low and moved it while the AI read: nothing is overwritten, and no note.
    const u = await createTicket({ orgId: ORG, channel: "chat", customerEmail: "lee@example.com", customerName: "Lee", subject: "Idea", body: "Dark mode?", authorType: "customer" });
    await db.update(schema.tickets).set({ priority: "low", groupId: billing.id }).where(eq(schema.tickets.id, u.id));
    assert.deepEqual(await applyTriage(ORG, u.id, out({ priority: "urgent", group: "Billing" }), [], [billing]), {});
    const after = await db.select().from(schema.messages).where(eq(schema.messages.ticketId, u.id));
    assert.ok(!after.some((m) => m.body.startsWith("AI triage:")));
  });
}
