// The AI test drive. A team that just moved in can't judge a cheap AI by its
// price, so Flatdesk shows them: the AI drafts answers to their own recent
// tickets, with their own macros and notes, and each draft sits beside the
// reply their team actually sent. The team rates each one.
//
// Drafts are never sent and never touch the AI allowance or receipts. We pay
// for the calls, up to TEST_DRIVE.budgetUsd per org across every run.
//
// The test drive page drives the work: it calls runTestDriveStep in a loop,
// and each step drafts a few tickets in parallel.

import { and, asc, count, eq, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { aiConfigured, draftAnswer, loadKnowledge } from "@/lib/ai";
import { attachmentsByMessage } from "@/lib/attachments";
import { access } from "@/lib/billing";

export const TEST_DRIVE = {
  tickets: 50,
  budgetUsd: 10,
  perStep: 3,
  // The most one call can cost: 16k output tokens plus a full cache write of
  // the prompt with 100 macros. Held back per call in flight, and charged for a
  // call that failed or died, since the API may still bill for it.
  reserveUsd: 0.55,
  // A call that hasn't finished in this long died with its function; queue it again.
  staleMs: 5 * 60_000,
  callTimeoutMs: 110_000, // under the step route's maxDuration
};

const { orgs, tickets, messages, customers, agents, testDriveDrafts: drafts } = schema;

export type Verdict = (typeof schema.testDriveVerdict.enumValues)[number];
export const VERDICT_LABEL: Record<Verdict, string> = { send: "Would send as is", edit: "Needs edits", wrong: "Wrong" };

export class TestDriveError extends Error {}

const lock = (tx: Pick<typeof db, "execute">, orgId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`test-drive:${orgId}`}))`);

// Recent tickets that make a fair comparison: they start with a customer's
// message, someone on the team replied, and the AI never touched them.
export async function pickTickets(orgId: string, limit = TEST_DRIVE.tickets): Promise<string[]> {
  const { rows } = await db.execute<{ id: string }>(sql`
    select t.id from (
      select id, created_at from ${tickets} where org_id = ${orgId} and not test order by created_at desc limit ${limit * 20}
    ) t
    where (
      select m.author_type from ${messages} m where m.ticket_id = t.id and not m.internal order by m.created_at, m.id limit 1
    ) = 'customer'
      and exists (select 1 from ${messages} m where m.ticket_id = t.id and m.author_type = 'agent' and not m.internal)
      and not exists (select 1 from ${messages} m where m.ticket_id = t.id and m.author_type = 'ai')
    order by t.created_at desc
    limit ${limit}`);
  return rows.map((r) => r.id);
}

export async function spentUsd(orgId: string) {
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, orgId), columns: { testDriveSpentUsd: true } });
  return Number(org?.testDriveSpentUsd ?? 0);
}

// Queues a fresh run over the most recent tickets, replacing any earlier run.
export async function startTestDrive(orgId: string): Promise<number> {
  if (!aiConfigured()) throw new TestDriveError("The AI isn't connected on this server yet.");
  const ids = await pickTickets(orgId);
  return db.transaction(async (tx) => {
    await lock(tx, orgId);
    const org = await tx.query.orgs.findFirst({ where: eq(orgs.id, orgId) });
    if (!org) throw new TestDriveError("Workspace not found.");
    if (access(org).state === "locked") throw new TestDriveError("The free trial has ended. Add a card in Settings to keep going.");
    if (!org.aiProcessing) throw new TestDriveError("AI processing is turned off for your team. An admin can turn it back on in Settings.");
    if (Number(org.testDriveSpentUsd) >= TEST_DRIVE.budgetUsd) throw new TestDriveError("This workspace has used its test drives.");
    const [{ active }] = await tx
      .select({ active: count() })
      .from(drafts)
      .where(and(eq(drafts.orgId, orgId), inArray(drafts.status, ["queued", "running"])));
    if (Number(active) > 0) return Number(active);
    if (ids.length === 0) throw new TestDriveError("There are no tickets with a reply from your team yet. Import your history or answer a few tickets first.");
    await tx.delete(drafts).where(eq(drafts.orgId, orgId));
    await tx.insert(drafts).values(ids.map((ticketId) => ({ orgId, ticketId })));
    return ids.length;
  });
}

export type Progress = { queued: number; running: number; done: number; failed: number; skipped: number; spentUsd: number; finished: boolean };

export async function testDriveProgress(orgId: string): Promise<Progress> {
  const [rows, spent] = await Promise.all([
    db.select({ status: drafts.status, n: count() }).from(drafts).where(eq(drafts.orgId, orgId)).groupBy(drafts.status),
    spentUsd(orgId),
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)])) as Partial<Record<string, number>>;
  const p = { queued: by.queued ?? 0, running: by.running ?? 0, done: by.done ?? 0, failed: by.failed ?? 0, skipped: by.skipped ?? 0, spentUsd: spent };
  return { ...p, finished: p.queued + p.running === 0 };
}

// Claims a few queued tickets, within what's left of the budget, and drafts
// them. Returns where the run stands. `draft` is swappable for tests.
export async function runTestDriveStep(orgId: string, draft: typeof draftAnswer = draftAnswer): Promise<Progress> {
  const claimed = await db.transaction(async (tx) => {
    await lock(tx, orgId);
    const org = await tx.query.orgs.findFirst({ where: eq(orgs.id, orgId) });
    if (!org || access(org).state === "locked") return [];
    const stale = await tx
      .update(drafts)
      .set({ status: "queued", startedAt: null })
      .where(and(eq(drafts.orgId, orgId), eq(drafts.status, "running"), lt(drafts.startedAt, new Date(Date.now() - TEST_DRIVE.staleMs))))
      .returning({ id: drafts.id });
    const lost = stale.length * TEST_DRIVE.reserveUsd;
    if (lost) await tx.update(orgs).set({ testDriveSpentUsd: sql`${orgs.testDriveSpentUsd} + ${lost}` }).where(eq(orgs.id, orgId));
    const left = TEST_DRIVE.budgetUsd - Number(org.testDriveSpentUsd) - lost;
    if (left <= 0) {
      await tx
        .update(drafts)
        .set({ status: "skipped", error: "The test drive budget ran out before this ticket." })
        .where(and(eq(drafts.orgId, orgId), eq(drafts.status, "queued")));
      return [];
    }
    const [{ running }] = await tx.select({ running: count() }).from(drafts).where(and(eq(drafts.orgId, orgId), eq(drafts.status, "running")));
    const room = Math.min(TEST_DRIVE.perStep, Math.ceil(left / TEST_DRIVE.reserveUsd) - Number(running));
    if (room <= 0) return [];
    const next = await tx
      .select({ id: drafts.id })
      .from(drafts)
      .innerJoin(tickets, eq(tickets.id, drafts.ticketId))
      .where(and(eq(drafts.orgId, orgId), eq(drafts.status, "queued")))
      .orderBy(sql`${tickets.createdAt} desc`)
      .limit(room);
    if (next.length === 0) return [];
    return tx
      .update(drafts)
      .set({ status: "running", startedAt: new Date() })
      .where(inArray(
        drafts.id,
        next.map((n) => n.id),
      ))
      .returning({ id: drafts.id, ticketId: drafts.ticketId });
  });

  if (claimed.length > 0) {
    const [org, knowledge] = await Promise.all([db.query.orgs.findFirst({ where: eq(orgs.id, orgId) }), fairKnowledge(orgId)]);
    await Promise.all(claimed.map((c) => draftOne(orgId, org!, knowledge, c, draft)));
  }
  return testDriveProgress(orgId);
}

// The team's macros minus any Flatdesk wrote from repeated replies after the
// oldest ticket in the run: those may have been learned from the very replies
// the drafts are compared with, which would flatter the score.
export async function fairKnowledge(orgId: string) {
  const [oldest] = await db
    .select({ at: sql<Date | null>`min(${tickets.createdAt})` })
    .from(drafts)
    .innerJoin(tickets, eq(tickets.id, drafts.ticketId))
    .where(eq(drafts.orgId, orgId));
  const since = oldest?.at ? new Date(oldest.at) : null;
  return loadKnowledge(orgId, since ? { skipSuggestedSince: since } : undefined);
}

async function draftOne(
  orgId: string,
  org: { id: string; name: string; aiInstructions: string },
  knowledge: { name: string; body: string }[],
  row: { id: string; ticketId: string },
  draft: typeof draftAnswer,
) {
  const finish = (set: Partial<typeof drafts.$inferInsert>) =>
    db
      .update(drafts)
      .set({ ...set, finishedAt: new Date() })
      .where(and(eq(drafts.id, row.id), eq(drafts.status, "running")));
  try {
    const ticket = await db.query.tickets.findFirst({ where: and(eq(tickets.orgId, orgId), eq(tickets.id, row.ticketId)) });
    const [first] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.ticketId, row.ticketId), eq(messages.internal, false)))
      .orderBy(asc(messages.createdAt), asc(messages.id))
      .limit(1);
    if (!ticket || first?.authorType !== "customer") {
      await finish({ status: "failed", error: "The ticket changed since the test drive started." });
      return;
    }
    const customer = await db.query.customers.findFirst({ where: eq(customers.id, ticket.customerId) });
    const files = (await attachmentsByMessage(orgId, [first.id])).get(first.id) ?? [];
    const d = await draft(
      org,
      knowledge,
      {
        from: customer?.name ? `${customer.name} <${customer.email}>` : (customer?.email ?? ""),
        subject: ticket.subject,
        body: first.body,
        attached: files.map((f) => f.filename),
      },
      { timeout: TEST_DRIVE.callTimeoutMs, maxRetries: 0 },
    );
    await db.transaction(async (tx) => {
      // The call cost money either way; the row only takes it if it's still ours.
      await tx
        .update(orgs)
        .set({ testDriveSpentUsd: sql`${orgs.testDriveSpentUsd} + ${d.metered.costUsd}` })
        .where(eq(orgs.id, orgId));
      await tx
        .update(drafts)
        .set({
          status: "done",
          decision: d.decision,
          draft: d.reply || null,
          reason: d.reason,
          sources: d.sources,
          model: d.metered.model,
          costUsd: d.metered.costUsd,
          error: null,
          finishedAt: new Date(),
        })
        .where(and(eq(drafts.id, row.id), eq(drafts.status, "running")));
    });
  } catch (err) {
    console.error("test drive draft failed", err);
    // We can't tell whether the API billed a failed call, so charge the most it could have cost.
    await db.transaction(async (tx) => {
      const [failed] = await tx
        .update(drafts)
        .set({ status: "failed", error: "The AI service didn't respond in time for this ticket.", costUsd: TEST_DRIVE.reserveUsd.toFixed(5), finishedAt: new Date() })
        .where(and(eq(drafts.id, row.id), eq(drafts.status, "running")))
        .returning({ id: drafts.id });
      if (failed) await tx.update(orgs).set({ testDriveSpentUsd: sql`${orgs.testDriveSpentUsd} + ${TEST_DRIVE.reserveUsd}` }).where(eq(orgs.id, orgId));
    });
  }
}

export type DraftRow = {
  id: string;
  status: (typeof schema.testDriveStatus.enumValues)[number];
  decision: "answer" | "handoff" | null;
  draft: string | null;
  reason: string | null;
  sources: string[];
  error: string | null;
  verdict: Verdict | null;
  ticketNumber: number;
  subject: string;
  customer: string | null;
  question: string | null;
  teamReply: string | null;
  teamReplyBy: string | null;
};

// Every draft of the current run with the question and the team's real reply.
export async function testDriveDrafts(orgId: string): Promise<DraftRow[]> {
  const rows = await db
    .select({
      id: drafts.id,
      ticketId: drafts.ticketId,
      status: drafts.status,
      decision: drafts.decision,
      draft: drafts.draft,
      reason: drafts.reason,
      sources: drafts.sources,
      error: drafts.error,
      verdict: drafts.verdict,
      ticketNumber: tickets.number,
      subject: tickets.subject,
      customerName: customers.name,
      customerEmail: customers.email,
    })
    .from(drafts)
    .innerJoin(tickets, eq(tickets.id, drafts.ticketId))
    .leftJoin(customers, eq(customers.id, tickets.customerId))
    .where(eq(drafts.orgId, orgId))
    .orderBy(sql`${tickets.createdAt} desc`);
  if (rows.length === 0) return [];

  // The first public message is the question; the first agent reply after it is what the team sent.
  const thread = await db
    .select({
      ticketId: messages.ticketId,
      authorType: messages.authorType,
      authorId: messages.authorId,
      authorName: messages.authorName,
      body: messages.body,
    })
    .from(messages)
    .where(and(inArray(messages.ticketId, rows.map((r) => r.ticketId)), eq(messages.internal, false), inArray(messages.authorType, ["customer", "agent"])))
    .orderBy(asc(messages.createdAt), asc(messages.id));
  const byTicket = new Map<string, typeof thread>();
  for (const m of thread) byTicket.set(m.ticketId, [...(byTicket.get(m.ticketId) ?? []), m]);
  const team = new Map(
    (await db.select({ userId: agents.userId, name: agents.name }).from(agents).where(eq(agents.orgId, orgId))).map((a) => [a.userId, a.name]),
  );

  return rows.map((r) => {
    const msgs = byTicket.get(r.ticketId) ?? [];
    const question = msgs[0]?.authorType === "customer" ? msgs[0] : undefined;
    const reply = msgs.find((m) => m.authorType === "agent");
    return {
      id: r.id,
      status: r.status,
      decision: r.decision === "answer" || r.decision === "handoff" ? r.decision : null,
      draft: r.draft,
      reason: r.reason,
      sources: r.sources,
      error: r.error,
      verdict: r.verdict,
      ticketNumber: r.ticketNumber,
      subject: r.subject,
      customer: r.customerName || r.customerEmail || null,
      question: question?.body ?? null,
      teamReply: reply?.body ?? null,
      teamReplyBy: reply ? reply.authorName || (reply.authorId ? (team.get(reply.authorId) ?? null) : null) : null,
    };
  });
}

export type Scorecard = { drafted: number; answered: number; handedOff: number; rated: number } & Record<Verdict, number>;

export function scorecard(rows: DraftRow[]): Scorecard {
  const done = rows.filter((r) => r.status === "done");
  const answered = done.filter((r) => r.decision === "answer");
  const n = (v: Verdict) => answered.filter((r) => r.verdict === v).length;
  return {
    drafted: done.length,
    answered: answered.length,
    handedOff: done.length - answered.length,
    rated: answered.filter((r) => r.verdict).length,
    send: n("send"),
    edit: n("edit"),
    wrong: n("wrong"),
  };
}

export async function rateDraft(orgId: string, id: string, verdict: Verdict | null, userId: string) {
  await db
    .update(drafts)
    .set({ verdict, verdictBy: verdict ? userId : null })
    .where(and(eq(drafts.orgId, orgId), eq(drafts.id, id), eq(drafts.status, "done"), eq(drafts.decision, "answer")));
}
