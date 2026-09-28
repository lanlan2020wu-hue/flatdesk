import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { attachmentsByMessage } from "@/lib/attachments";
import { access } from "@/lib/billing";
import { deliverReply, emailConfig, resend } from "@/lib/email";
import { PLAN } from "@/lib/pricing";

// The AI answers the first message of new email and chat tickets. A reply counts as a
// resolution unless the customer writes back, which hands the ticket to the
// team and un-counts it (the pricing page promises exactly this). Each team
// gets PLAN.includedPerAgent resolutions per agent per month; past that the AI
// pauses unless an admin turned on overage. A team on its free trial with no
// card gets PLAN.trialPerAgent for the whole trial and no overage, which caps
// what an unpaid team can spend; adding a card lifts it to the full allowance.

const MODEL = "claude-opus-5-5";
// USD per million tokens, for internal cost logging. The system prompt is cached
// for an hour (small teams often go more than 5 minutes between tickets), which
// bills cache writes at 2x the input rate; cache reads are $0.20.
const PRICE_PER_MTOK = { input: 4, output: 20, cacheWrite: 8, cacheRead: 0.2 };
// Keeps a hung call from outliving the serverless function that started it.
const CALL_OPTIONS = { timeout: 120_000, maxRetries: 1 };

export function callCost(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}) {
  const p = PRICE_PER_MTOK;
  return (
    (usage.input_tokens * p.input +
      (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * p.cacheRead +
      usage.output_tokens * p.output) /
    1e6
  );
}
const AI_FOOTER = "\n\n--\nThis reply was written by our AI assistant. Reply to reach a person on our team.";

const { orgs, agents, tickets, messages, macros, aiEvents } = schema;

export const aiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

export function monthKey(d = new Date()) {
  return d.toISOString().slice(0, 7);
}

// "draft" rows are slots reserved while a call is in flight; they count toward
// the cap so parallel tickets can't overshoot it. A draft older than this was
// abandoned (the function was killed mid-call) and stops counting.
const DRAFT_TTL_MINUTES = 15;
// Handoffs and answers the customer replied to don't count toward the allowance,
// but each one is still a paid model call. This bounds every call, counted or
// not, at a multiple of the allowance.
export const ATTEMPTS_PER_INCLUDED = 3;
// A trial allowance is sized from everyone who signed in, capped so that
// inviting lots of people during the trial can't inflate it.
const TRIAL_AGENT_CAP = 10;

export type Usage = { included: number; used: number; overage: number; attempts: number; month: string; trial: boolean };
type Org = typeof orgs.$inferSelect;

// The allowance and what's used of it. During a no-card trial, usage counts
// across the whole trial (it can span two months), not just this month.
async function measure(q: Pick<typeof db, "select">, org: Org, month: string): Promise<Usage> {
  const trial = month === monthKey() && access(org).state === "trial";
  const where = [eq(aiEvents.orgId, org.id)];
  if (!trial) where.push(eq(aiEvents.month, month));
  const counted = sql`(${aiEvents.kind} = 'resolution' or (${aiEvents.kind} = 'draft' and ${aiEvents.createdAt} > now() - make_interval(mins => ${DRAFT_TTL_MINUTES})))`;
  const [[{ agentCount }], [{ used, overage, attempts }]] = await Promise.all([
    q.select({ agentCount: count() }).from(agents).where(eq(agents.orgId, org.id)),
    q
      .select({
        used: sql<number>`count(*) filter (where ${counted})`,
        overage: sql<number>`count(*) filter (where ${counted} and ${aiEvents.overage})`,
        attempts: count(),
      })
      .from(aiEvents)
      .where(and(...where)),
  ]);
  // A paying team's allowance follows the seats it pays for. Agent rows are
  // never deleted, so counting them would keep paying for people who left.
  const seats = trial ? Math.min(Number(agentCount), TRIAL_AGENT_CAP) : (org.billedSeats ?? Number(agentCount));
  const included = Math.max(1, seats) * (trial ? PLAN.trialPerAgent : PLAN.includedPerAgent);
  return { included, used: Number(used), overage: Number(overage), attempts: Number(attempts), month, trial };
}

export async function aiUsage(orgId: string, month = monthKey()): Promise<Usage> {
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, orgId) });
  if (!org) return { included: PLAN.includedPerAgent, used: 0, overage: 0, attempts: 0, month, trial: false };
  return measure(db, org, month);
}

type Slot = { eventId: string; overage: boolean } | { paused: string };

export async function reserveSlot(orgId: string, ticketId: string): Promise<Slot> {
  return db.transaction(async (tx) => {
    // One reservation at a time per org, so the count below stays true.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}))`);
    const org = await tx.query.orgs.findFirst({ where: eq(orgs.id, orgId) });
    if (!org) return { paused: "missing org" };
    const month = monthKey();
    const { included, used, overage, attempts, trial } = await measure(tx, org, month);
    // Overage extends the allowance, so it extends the attempt limit with it.
    const overageRoom = org.aiOverageEnabled && !trial ? (org.aiOverageMonthlyLimit ?? included) : 0;
    if (attempts >= (included + overageRoom) * ATTEMPTS_PER_INCLUDED) {
      return { paused: "The AI has handed an unusually large number of tickets to the team this month, so it's paused until next month. Adding saved answers for common questions helps it answer more of them." };
    }
    const isOverage = used >= included;
    if (isOverage && trial) {
      return { paused: `The AI has used the ${included} answers included in the free trial, so it's paused. Adding a card in Settings unlocks the full ${PLAN.includedPerAgent} per agent each month.` };
    }
    if (isOverage) {
      if (!org.aiOverageEnabled) return { paused: "The AI has used this month's included answers, so it's paused until next month." };
      if (org.aiOverageMonthlyLimit != null && Number(overage) >= org.aiOverageMonthlyLimit) {
        return { paused: "The AI reached this month's overage limit, so it's paused until next month." };
      }
    }
    const [event] = await tx
      .insert(aiEvents)
      .values({ orgId, ticketId, kind: "draft", month, overage: isOverage, model: MODEL })
      .returning({ id: aiEvents.id });
    return { eventId: event.id, overage: isOverage };
  });
}

const Decision = z.object({
  decision: z.enum(["answer", "handoff"]),
  reply: z.string().describe("The email reply to the customer. Empty when handing off."),
  reason: z.string().describe("One sentence for the support team on why you answered or handed off."),
  sources: z.array(z.string()).describe("Exact titles of the saved answers your reply relies on. Empty when handing off or when you used only the team notes."),
});

function systemPrompt(orgName: string, instructions: string, knowledge: { name: string; body: string }[]) {
  const kb = knowledge.map((m) => `<answer title="${m.name.replace(/"/g, "'")}">\n${m.body}\n</answer>`).join("\n");
  return `You answer customer support emails for ${orgName}. Your reply is emailed to the customer as-is.

Answer only when the team's notes or saved answers below cover the question. Hand off to the team when:
- the question needs facts you don't have (their account, an order, a bug you can't confirm, anything not in the material below)
- they ask for a refund, a cancellation, a billing change or any other action on their account
- they ask for a person, are upset, or the message is a complaint, a legal matter or a security report
- the message isn't a support question (spam, sales pitches, auto-generated mail)
- the question depends on an attached file (a screenshot, an invoice, a log): you can see only the file names

Never invent prices, policies, dates, links or promises. If the material covers part of the question, hand off rather than answer half.

When you answer: write plain text, no markdown. Greet the customer by first name if you know it, answer directly, keep it short, and sign off as "${orgName} support". Match the language the customer wrote in.

<team_notes>
${instructions.trim() || "(none)"}
</team_notes>

<saved_answers>
${kb || "(none)"}
</saved_answers>`;
}

async function note(orgId: string, ticketId: string, body: string) {
  await db.insert(messages).values({ orgId, ticketId, authorType: "system", body, internal: true });
}

// Runs after the webhook has responded. Never throws: failures become an
// internal note and the ticket stays with the team.
export async function answerNewTicket(orgId: string, ticketId: string) {
  if (!aiConfigured()) return;
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, orgId) });
  const ticket = await db.query.tickets.findFirst({ where: and(eq(tickets.orgId, orgId), eq(tickets.id, ticketId)) });
  if (!org?.aiEnabled || !ticket || ticket.status !== "open") return;
  if (access(org).state === "locked") {
    await note(orgId, ticketId, "The AI didn't answer because the free trial has ended. An admin can add a card in Settings.");
    return;
  }

  const thread = await db.select().from(messages).where(eq(messages.ticketId, ticketId)).orderBy(asc(messages.createdAt));
  if (thread.length !== 1 || thread[0].authorType !== "customer") return;
  const customer = await db.query.customers.findFirst({ where: eq(schema.customers.id, ticket.customerId) });
  const attached = (await attachmentsByMessage(orgId, [thread[0].id])).get(thread[0].id) ?? [];

  const slot = await reserveSlot(orgId, ticketId);
  if ("paused" in slot) {
    await note(orgId, ticketId, slot.paused);
    await sendUsageNotice(orgId);
    return;
  }

  try {
    const knowledge = await db
      .select({ name: macros.name, body: macros.body })
      .from(macros)
      .where(eq(macros.orgId, orgId))
      .orderBy(asc(macros.name))
      .limit(100);

    const client = new Anthropic();
    const response = await client.beta.messages.parse(
      {
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: zodOutputFormat(Decision) },
      system: [{ type: "text", text: systemPrompt(org.name, org.aiInstructions, knowledge), cache_control: { type: "ephemeral", ttl: "1h" } }],
      messages: [
        {
          role: "user",
          content: `From: ${customer?.name ? `${customer.name} <${customer.email}>` : customer?.email}\nSubject: ${ticket.subject}${
            attached.length ? `\nAttached files: ${attached.map((f) => f.filename).join(", ")}` : ""
          }\n\n${thread[0].body}`,
        },
      ],
      },
      CALL_OPTIONS,
    );

    const usage = response.usage;
    const inputTokens = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    const metered = { model: response.model, inputTokens, outputTokens: usage.output_tokens, costUsd: callCost(usage).toFixed(5) };

    const out = response.stop_reason === "refusal" ? null : response.parsed_output;
    // Keep only titles that name a real saved answer, so the receipt never cites something that doesn't exist.
    // The prompt shows titles with double quotes swapped for single ones.
    const titles = new Map(knowledge.map((k) => [k.name.replace(/"/g, "'"), k.name]));
    const sources = [...new Set((out?.sources ?? []).map((t) => titles.get(t.trim())).filter((t) => t !== undefined))];
    const reason = out?.reason?.slice(0, 500) || null;
    if (!out || out.decision === "handoff" || !out.reply.trim()) {
      await db.update(aiEvents).set({ kind: "handoff", reason, ...metered }).where(eq(aiEvents.id, slot.eventId));
      await note(orgId, ticketId, `AI handed this to the team: ${out?.reason || "it couldn't produce an answer."}`);
      return;
    }

    // The customer may have written again, or an agent may have picked the
    // ticket up, while the model was thinking. Their work wins.
    const now = new Date();
    const messageId = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).for("update");
      const [{ n }] = await tx.select({ n: count() }).from(messages).where(eq(messages.ticketId, ticketId));
      if (!current || current.status !== "open" || Number(n) !== 1) return null;
      const [m] = await tx
        .insert(messages)
        .values({ orgId, ticketId, authorType: "ai", body: out.reply.trim() + AI_FOOTER, createdAt: now })
        .returning({ id: messages.id });
      await tx.insert(messages).values({
        orgId,
        ticketId,
        authorType: "system",
        internal: true,
        body: `AI answered: ${out.reason}`,
        createdAt: new Date(now.getTime() + 1), // sorts under the answer it explains
      });
      await tx
        .update(tickets)
        .set({ status: "pending", resolvedByAi: true, firstResponseAt: now, updatedAt: now })
        .where(eq(tickets.id, ticketId));
      await tx.update(aiEvents).set({ kind: "resolution", sources, reason, ...metered }).where(eq(aiEvents.id, slot.eventId));
      return m.id;
    });
    if (!messageId) {
      await db.update(aiEvents).set({ kind: "handoff", reason: "A person picked the ticket up first.", ...metered }).where(eq(aiEvents.id, slot.eventId));
      return;
    }
    // The answer is saved and counted. A failed send is retried from the
    // ticket like any reply, so it must not un-count the answer below.
    try {
      await deliverReply(orgId, messageId);
      await sendUsageNotice(orgId);
    } catch (err) {
      console.error("AI answer saved but sending failed", err);
      await note(orgId, ticketId, "The AI answered, but the email didn't go out. Resend it from the ticket.");
    }
  } catch (err) {
    // Only a slot still in flight is released; a finished answer or handoff stays on record.
    await db.delete(aiEvents).where(and(eq(aiEvents.id, slot.eventId), eq(aiEvents.kind, "draft")));
    const reason = err instanceof Anthropic.APIError ? `the AI service returned an error (${err.status ?? "network"})` : "of an internal error";
    console.error("AI answer failed", err);
    await note(orgId, ticketId, `AI didn't answer because ${reason}. The ticket is with the team.`);
  }
}

// The customer wrote back after an AI answer: the ticket goes to the team and
// the answer no longer counts as a resolution.
export async function handBackToTeam(orgId: string, ticketId: string) {
  const [ticket] = await db
    .update(tickets)
    .set({ resolvedByAi: false })
    .where(and(eq(tickets.orgId, orgId), eq(tickets.id, ticketId), eq(tickets.resolvedByAi, true)))
    .returning({ id: tickets.id });
  if (!ticket) return;
  await db
    .update(aiEvents)
    .set({ kind: "handoff" })
    .where(and(eq(aiEvents.orgId, orgId), eq(aiEvents.ticketId, ticketId), eq(aiEvents.kind, "resolution")));
  await note(orgId, ticketId, "The customer replied to the AI answer, so this ticket is now with the team and doesn't count toward the AI allowance.");
}

// Emails admins once at 80% and once at 100% of the included allowance.
export async function sendUsageNotice(orgId: string) {
  const { included, used, month: thisMonth, trial } = await aiUsage(orgId);
  const level = used >= included ? 100 : used >= included * 0.8 ? 80 : 0;
  if (!level) return;
  // The trial allowance gets its own notices, separate from any month's.
  const month = trial ? "trial" : thisMonth;
  const [claimed] = await db
    .update(orgs)
    .set({ aiNoticeMonth: month, aiNoticeLevel: level })
    .where(
      and(
        eq(orgs.id, orgId),
        sql`(${orgs.aiNoticeMonth} is distinct from ${month} or ${orgs.aiNoticeLevel} < ${level})`,
      ),
    )
    .returning();
  if (!claimed || !emailConfig.apiKey || !emailConfig.from) return;

  const admins = await db.select({ email: agents.email }).from(agents).where(and(eq(agents.orgId, orgId), eq(agents.role, "admin")));
  if (admins.length === 0) return;
  if (trial) {
    const body =
      level === 100
        ? `Your team has used all ${included} AI answers included in the free trial, so the AI is paused and new tickets go to your team.`
        : `Your team has used ${used} of the ${included} AI answers included in the free trial (${Math.round((used / included) * 100)}%).`;
    const { error } = await resend().emails.send({
      from: `Flatdesk <${emailConfig.from}>`,
      to: admins.map((a) => a.email),
      subject: level === 100 ? "Your trial's AI answers are used up" : "You've used 80% of your trial's AI answers",
      text: `${body}\n\nAdd a card in Flatdesk under Settings to get the full ${PLAN.includedPerAgent} AI answers per agent each month. The first charge still waits until the trial ends.`,
    });
    if (error) console.error("usage notice failed", error);
    return;
  }
  const after = claimed.aiOverageEnabled
    ? `Overage is on, so the AI keeps answering at $${PLAN.overageRate.toFixed(2)} per resolution${claimed.aiOverageMonthlyLimit != null ? `, up to ${claimed.aiOverageMonthlyLimit} more this month` : ""}.`
    : "Overage is off, so once the allowance is used up the AI pauses and new tickets go to your team. Nothing extra is charged.";
  const body =
    level === 100
      ? `Your team has used all ${included} AI answers included this month. ${after}\n\nThe allowance resets on the 1st.`
      : `Your team has used ${used} of the ${included} AI answers included this month (${Math.round((used / included) * 100)}%). ${after}`;
  const { error } = await resend().emails.send({
    from: `Flatdesk <${emailConfig.from}>`,
    to: admins.map((a) => a.email),
    subject: level === 100 ? "Your AI allowance is used up for this month" : "You've used 80% of this month's AI allowance",
    text: `${body}\n\nYou can change AI settings in Flatdesk under Settings.`,
  });
  if (error) console.error("usage notice failed", error);
}
