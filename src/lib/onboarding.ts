import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Onboarding, OnboardingStep } from "@/db/schema";
import { aiConfigured, draftAnswer, loadKnowledge } from "@/lib/ai";
import { access } from "@/lib/billing";
import { TEST_DRIVE, TestDriveError } from "@/lib/test-drive";

// The new-team checklist at /app/welcome. Each step is done when the real
// thing happened (the AI answered, a forwarded email arrived, an import ran),
// when the admin said so, or when they chose to skip it.

export const TEST_TAG = "flatdesk-test";
export type StepId = "team" | OnboardingStep;
export type Step = { id: StepId; title: string; done: boolean; skipped: boolean };

export async function getOnboarding(orgId: string) {
  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, orgId) });
  if (!org) throw new Error("Team not found.");
  const ob = org.onboarding;
  const skipped = new Set(ob.skipped ?? []);

  const [[agents], [inbound], [testEmails], [chats], [imports], aiAnswers, aiDrafts, testTicket] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(schema.agents).where(eq(schema.agents.orgId, orgId)),
    // A real email reached the team's inbox (not the test email).
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.messages)
      .innerJoin(schema.tickets, eq(schema.tickets.id, schema.messages.ticketId))
      .where(and(eq(schema.messages.orgId, orgId), isNotNull(schema.messages.emailMessageId), sql`not (${TEST_TAG} = any(${schema.tickets.tags}))`, eq(schema.tickets.test, false))),
    // The end-to-end test email came back through forwarding.
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.messages)
      .innerJoin(schema.tickets, eq(schema.tickets.id, schema.messages.ticketId))
      .where(and(eq(schema.messages.orgId, orgId), isNotNull(schema.messages.emailMessageId), sql`${TEST_TAG} = any(${schema.tickets.tags})`)),
    // Someone wrote in through the chat widget (the admin trying it counts).
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.tickets)
      .where(and(eq(schema.tickets.orgId, orgId), eq(schema.tickets.channel, "chat"), sql`not (${TEST_TAG} = any(${schema.tickets.tags}))`, eq(schema.tickets.test, false))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.imports).where(and(eq(schema.imports.orgId, orgId), inArray(schema.imports.status, ["running", "done"]))),
    // The AI answered a real ticket, or drafted an answer in the test drive.
    db.$count(schema.aiEvents, and(eq(schema.aiEvents.orgId, orgId), eq(schema.aiEvents.kind, "resolution"))),
    db.$count(schema.testDriveDrafts, and(eq(schema.testDriveDrafts.orgId, orgId), eq(schema.testDriveDrafts.status, "done"))),
    db.query.tickets.findFirst({
      columns: { number: true, createdAt: true, channel: true },
      where: and(eq(schema.tickets.orgId, orgId), sql`${TEST_TAG} = any(${schema.tickets.tags})`),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    }),
  ]);

  const testEmailArrived = testEmails.n > 0;
  const chatSeen = chats.n > 0;
  const invited = (ob.invited?.length ?? 0) > 0 || agents.n > 1;
  const aiSeen = Boolean(ob.aiAnswered) || aiAnswers > 0 || aiDrafts > 0;
  const connected = inbound.n > 0 || testEmailArrived || chatSeen || Boolean(ob.forwardingConfirmed) || Boolean(ob.widgetAdded);
  // A real message has to come through. A sample ticket is for a look around and doesn't count.
  const proven = inbound.n > 0 || testEmailArrived || chatSeen;
  const step = (id: StepId, title: string, done: boolean): Step => ({ id, title, done: done || (id !== "team" && skipped.has(id)), skipped: !done && id !== "team" && skipped.has(id) });
  // Seeing the AI answer comes right after the team: it's what Flatdesk is for, and it needs nothing set up.
  const steps: Step[] = [
    step("team", "Create your team", true),
    step("ai", "See the AI answer a question", aiSeen),
    step("inbox", "Connect email or website chat", connected),
    step("invite", "Invite your agents", invited),
    step("import", "Bring over your old help desk", imports.n > 0),
    step("test", "Send a test message", proven),
  ];
  const doneCount = steps.filter((s) => s.done).length;
  return {
    org,
    ob,
    steps,
    doneCount,
    complete: doneCount === steps.length,
    // Shown until finished or hidden; teams that already have tickets don't need it pushed at them.
    visible: !ob.dismissed && doneCount < steps.length,
    testTicket: testTicket ?? null,
    testEmailArrived,
    inboundSeen: inbound.n > 0,
    chatSeen,
  };
}

export type TryResult = { decision: "answer" | "handoff"; reply: string; reason: string | null; sources: string[] };

// One question the admin types during setup, answered by the AI exactly as it
// would answer a customer, from the team's notes and saved answers. Nothing is
// sent and nothing counts against the AI allowance; the call is paid from the
// same per-team budget as the test drive. `draft` is swappable for tests.
export async function tryTheAi(orgId: string, question: string, draft: typeof draftAnswer = draftAnswer): Promise<TryResult> {
  if (!aiConfigured()) throw new TestDriveError("The AI isn't connected on this server yet.");
  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, orgId) });
  if (!org) throw new TestDriveError("Team not found.");
  if (access(org).state === "locked") throw new TestDriveError("The free trial has ended. Add a card in Settings to keep going.");
  // Hold the most a call can cost before making it, in one statement, so quick
  // repeated tries can't all pass the budget check at once.
  const [held] = await db
    .update(schema.orgs)
    .set({ testDriveSpentUsd: sql`${schema.orgs.testDriveSpentUsd} + ${TEST_DRIVE.reserveUsd}` })
    .where(and(eq(schema.orgs.id, orgId), sql`${schema.orgs.testDriveSpentUsd} + ${TEST_DRIVE.reserveUsd} <= ${TEST_DRIVE.budgetUsd}`))
    .returning({ id: schema.orgs.id });
  if (!held) throw new TestDriveError("You've used up the free tries. Once your inbox is connected, the AI will answer real tickets.");
  // A call that fails may still have been charged, so the hold stays unless it finishes.
  const d = await draft(
    org,
    await loadKnowledge(orgId),
    { from: "A customer <customer@example.com>", subject: question.split("\n")[0].slice(0, 120), body: question, attached: [] },
    { timeout: TEST_DRIVE.callTimeoutMs, maxRetries: 0 },
  );
  await db
    .update(schema.orgs)
    .set({ testDriveSpentUsd: sql`${schema.orgs.testDriveSpentUsd} + ${d.metered.costUsd} - ${TEST_DRIVE.reserveUsd}` })
    .where(eq(schema.orgs.id, orgId));
  if (d.decision === "answer") await updateOnboarding(orgId, (ob) => ({ ...ob, aiAnswered: true }));
  return { decision: d.decision, reply: d.reply, reason: d.reason, sources: d.sources };
}

export async function updateOnboarding(orgId: string, patch: (ob: Onboarding) => Onboarding) {
  // Read-modify-write inside a row lock so two quick clicks don't lose a change.
  await db.transaction(async (tx) => {
    const [org] = await tx.select({ ob: schema.orgs.onboarding }).from(schema.orgs).where(eq(schema.orgs.id, orgId)).for("update");
    if (!org) return;
    await tx.update(schema.orgs).set({ onboarding: patch(org.ob) }).where(eq(schema.orgs.id, orgId));
  });
}
