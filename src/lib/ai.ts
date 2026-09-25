import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { deliverReply, emailConfig, resend } from "@/lib/email";
import { PLAN } from "@/lib/pricing";

// The AI answers the first message of new email tickets. A reply counts as a
// resolution unless the customer writes back, which hands the ticket to the
// team and un-counts it (the pricing page promises exactly this). Each team
// gets PLAN.includedPerAgent resolutions per agent per month; past that the AI
// pauses unless an admin turned on overage.

const MODEL = "claude-opus-5";
const PRICE_PER_MTOK = { input: 5, output: 25 }; // USD, for internal cost logging
const AI_FOOTER = "\n\n--\nThis reply was written by our AI assistant. Reply to this email to reach a person on our team.";

const { orgs, agents, tickets, messages, macros, aiEvents } = schema;

export const aiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

export function monthKey(d = new Date()) {
  return d.toISOString().slice(0, 7);
}

// "draft" rows are slots reserved while a call is in flight; they count toward
// the cap so parallel tickets can't overshoot it.
const COUNTED = ["resolution", "draft"] as const;

export async function aiUsage(orgId: string, month = monthKey()) {
  const [[{ agentCount }], [{ used, overage }]] = await Promise.all([
    db.select({ agentCount: count() }).from(agents).where(eq(agents.orgId, orgId)),
    db
      .select({
        used: count(),
        overage: sql<number>`count(*) filter (where ${aiEvents.overage})`,
      })
      .from(aiEvents)
      .where(and(eq(aiEvents.orgId, orgId), eq(aiEvents.month, month), inArray(aiEvents.kind, [...COUNTED]))),
  ]);
  const included = Math.max(1, agentCount) * PLAN.includedPerAgent;
  return { included, used: Number(used), overage: Number(overage), month };
}

type Slot = { eventId: string; overage: boolean } | { paused: string };

async function reserveSlot(orgId: string, ticketId: string): Promise<Slot> {
  return db.transaction(async (tx) => {
    // One reservation at a time per org, so the count below stays true.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}))`);
    const org = await tx.query.orgs.findFirst({ where: eq(orgs.id, orgId) });
    if (!org) return { paused: "missing org" };
    const month = monthKey();
    const [[{ agentCount }], [{ used, overage }]] = await Promise.all([
      tx.select({ agentCount: count() }).from(agents).where(eq(agents.orgId, orgId)),
      tx
        .select({ used: count(), overage: sql<number>`count(*) filter (where ${aiEvents.overage})` })
        .from(aiEvents)
        .where(and(eq(aiEvents.orgId, orgId), eq(aiEvents.month, month), inArray(aiEvents.kind, [...COUNTED]))),
    ]);
    const included = Math.max(1, agentCount) * PLAN.includedPerAgent;
    const isOverage = Number(used) >= included;
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
});

function systemPrompt(orgName: string, instructions: string, knowledge: { name: string; body: string }[]) {
  const kb = knowledge.map((m) => `<answer title="${m.name.replace(/"/g, "'")}">\n${m.body}\n</answer>`).join("\n");
  return `You answer customer support emails for ${orgName}. Your reply is emailed to the customer as-is.

Answer only when the team's notes or saved answers below cover the question. Hand off to the team when:
- the question needs facts you don't have (their account, an order, a bug you can't confirm, anything not in the material below)
- they ask for a refund, a cancellation, a billing change or any other action on their account
- they ask for a person, are upset, or the message is a complaint, a legal matter or a security report
- the message isn't a support question (spam, sales pitches, auto-generated mail)

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
  if (!org?.aiEnabled || !ticket || ticket.channel !== "email" || ticket.status !== "open") return;

  const thread = await db.select().from(messages).where(eq(messages.ticketId, ticketId)).orderBy(asc(messages.createdAt));
  if (thread.length !== 1 || thread[0].authorType !== "customer") return;
  const customer = await db.query.customers.findFirst({ where: eq(schema.customers.id, ticket.customerId) });

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
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: zodOutputFormat(Decision) },
      system: [{ type: "text", text: systemPrompt(org.name, org.aiInstructions, knowledge), cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `From: ${customer?.name ? `${customer.name} <${customer.email}>` : customer?.email}\nSubject: ${ticket.subject}\n\n${thread[0].body}`,
        },
      ],
    });

    const usage = response.usage;
    const inputTokens = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    const costUsd = (inputTokens * PRICE_PER_MTOK.input + usage.output_tokens * PRICE_PER_MTOK.output) / 1e6;
    const metered = { model: response.model, inputTokens, outputTokens: usage.output_tokens, costUsd: costUsd.toFixed(5) };

    const out = response.stop_reason === "refusal" ? null : response.parsed_output;
    if (!out || out.decision === "handoff" || !out.reply.trim()) {
      await db.update(aiEvents).set({ kind: "handoff", ...metered }).where(eq(aiEvents.id, slot.eventId));
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
      await tx.update(aiEvents).set({ kind: "resolution", ...metered }).where(eq(aiEvents.id, slot.eventId));
      return m.id;
    });
    if (!messageId) {
      await db.update(aiEvents).set({ kind: "handoff", ...metered }).where(eq(aiEvents.id, slot.eventId));
      return;
    }
    await deliverReply(orgId, messageId);
    await sendUsageNotice(orgId);
  } catch (err) {
    await db.delete(aiEvents).where(eq(aiEvents.id, slot.eventId));
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
  const { included, used, month } = await aiUsage(orgId);
  const level = used >= included ? 100 : used >= included * 0.8 ? 80 : 0;
  if (!level) return;
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
