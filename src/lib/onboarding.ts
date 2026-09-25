import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Onboarding, OnboardingStep } from "@/db/schema";

// The new-team checklist at /app/welcome. Each step is done when the real
// thing happened (a forwarded email arrived, an import ran), when the admin
// said so, or when they chose to skip it.

export const TEST_TAG = "flatdesk-test";
export type StepId = "team" | OnboardingStep;
export type Step = { id: StepId; title: string; done: boolean; skipped: boolean };

export async function getOnboarding(orgId: string) {
  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, orgId) });
  if (!org) throw new Error("Team not found.");
  const ob = org.onboarding;
  const skipped = new Set(ob.skipped ?? []);

  const [[agents], [inbound], [testEmails], [imports], testTicket] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(schema.agents).where(eq(schema.agents.orgId, orgId)),
    // A real email reached the team's inbox (not the test email).
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.messages)
      .innerJoin(schema.tickets, eq(schema.tickets.id, schema.messages.ticketId))
      .where(and(eq(schema.messages.orgId, orgId), isNotNull(schema.messages.emailMessageId), sql`not (${TEST_TAG} = any(${schema.tickets.tags}))`)),
    // The end-to-end test email came back through forwarding.
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.messages)
      .innerJoin(schema.tickets, eq(schema.tickets.id, schema.messages.ticketId))
      .where(and(eq(schema.messages.orgId, orgId), isNotNull(schema.messages.emailMessageId), sql`${TEST_TAG} = any(${schema.tickets.tags})`)),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.imports).where(and(eq(schema.imports.orgId, orgId), inArray(schema.imports.status, ["running", "done"]))),
    db.query.tickets.findFirst({
      columns: { number: true, createdAt: true, channel: true },
      where: and(eq(schema.tickets.orgId, orgId), sql`${TEST_TAG} = any(${schema.tickets.tags})`),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    }),
  ]);

  const testEmailArrived = testEmails.n > 0;
  const invited = (ob.invited?.length ?? 0) > 0 || agents.n > 1;
  const steps: Step[] = [
    { id: "team", title: "Create your team", done: true, skipped: false },
    { id: "invite", title: "Invite your agents", done: invited || skipped.has("invite"), skipped: !invited && skipped.has("invite") },
    { id: "inbox", title: "Connect your support inbox", done: inbound.n > 0 || testEmailArrived || Boolean(ob.forwardingConfirmed) || skipped.has("inbox"), skipped: inbound.n === 0 && !testEmailArrived && !ob.forwardingConfirmed && skipped.has("inbox") },
    { id: "import", title: "Bring over your old help desk", done: imports.n > 0 || skipped.has("import"), skipped: imports.n === 0 && skipped.has("import") },
    { id: "test", title: "Send a test ticket", done: Boolean(testTicket) || skipped.has("test"), skipped: !testTicket && skipped.has("test") },
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
  };
}

export async function updateOnboarding(orgId: string, patch: (ob: Onboarding) => Onboarding) {
  // Read-modify-write inside a row lock so two quick clicks don't lose a change.
  await db.transaction(async (tx) => {
    const [org] = await tx.select({ ob: schema.orgs.onboarding }).from(schema.orgs).where(eq(schema.orgs.id, orgId)).for("update");
    if (!org) return;
    await tx.update(schema.orgs).set({ onboarding: patch(org.ob) }).where(eq(schema.orgs.id, orgId));
  });
}
