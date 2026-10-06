// The agent copilot: AI help for the person answering a ticket. It summarizes
// the conversation, drafts a reply from the team's macros and help center, and
// rewrites what the agent typed. Nothing is sent without the agent.
//
// Other help desks sell this as a per-agent add-on. In Flatdesk it's in the
// seat, under a fair-use limit of COPILOT.perAgent actions per seat a month,
// pooled across the team. It never counts toward the AI allowance (that's for
// answers sent to customers) and never shows on receipts.

import { and, asc, count, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { CACHE_MIN_WEEKLY_CALLS, MODEL, aiConfigured, loadKnowledge, monthKey } from "@/lib/ai";
import { access } from "@/lib/billing";
import { COPILOT, REWRITE_LABEL, REWRITE_STYLES, type RewriteStyle } from "@/lib/copilot-config";
import { isForeign, isLanguage, languageLabel } from "@/lib/language";
import { structuredCall, type Metered } from "@/lib/llm";

export { COPILOT, REWRITE_LABEL, REWRITE_STYLES, type RewriteStyle };

export class CopilotError extends Error {}

const { orgs, agents, tickets, messages, customers, copilotEvents: events } = schema;

export type CopilotUsage = { used: number; limit: number; month: string };

export async function copilotUsage(orgId: string, month = monthKey(), q: Pick<typeof db, "select"> = db): Promise<CopilotUsage> {
  const [[org], [{ seats }], [{ used }]] = await Promise.all([
    q.select().from(orgs).where(eq(orgs.id, orgId)),
    q.select({ seats: count() }).from(agents).where(and(eq(agents.orgId, orgId), eq(agents.viewer, false), sql`${agents.removedAt} is null`)),
    q.select({ used: count() }).from(events).where(and(eq(events.orgId, orgId), eq(events.month, month))),
  ]);
  const trial = org ? access(org).state === "trial" : false;
  const people = trial ? Math.min(Number(seats), COPILOT.trialSeatCap) : (org?.billedSeats ?? Number(seats));
  return { used: Number(used), limit: Math.max(1, people) * COPILOT.perAgent, month };
}

// What an action is assumed to cost until its call reports back. It stays on
// an action whose call failed, since that call may still have been charged.
const RESERVE_USD = "0.05000";

type Kind = "summary" | "draft" | "rewrite" | "translate";

// Takes one action from the team's limit before the call is made: the count
// and the new row happen under a per-team lock, so quick clicks in several
// tabs can't all pass the limit at once. The row is filled in by settle().
async function reserveAction(orgId: string, userId: string, ticketId: string | null, kind: Kind) {
  if (!aiConfigured()) throw new CopilotError("The copilot isn't set up on this workspace yet.");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`copilot:${orgId}`}))`);
    const [org] = await tx.select().from(orgs).where(eq(orgs.id, orgId));
    if (!org || access(org).state === "locked") throw new CopilotError("The free trial has ended. An admin can add a card in Settings.");
    if (!org.aiProcessing) throw new CopilotError("AI processing is turned off for your team. An admin can turn it back on in Settings.");
    const u = await copilotUsage(orgId, monthKey(), tx);
    if (u.used >= u.limit) throw new CopilotError(`Your team has used this month's ${u.limit} copilot actions. They reset on the 1st.`);
    const [row] = await tx
      .insert(events)
      .values({ orgId, userId, ticketId, kind, month: monthKey(), model: MODEL, costUsd: RESERVE_USD })
      .returning({ id: events.id });
    return { org, eventId: row.id };
  });
}

type ThreadMessage = { id: string; authorType: string; internal: boolean; body: string; name: string };

// The conversation as the copilot reads it: oldest first, labelled, with the
// middle left out (and said so) when it's longer than COPILOT.threadChars.
export function threadText(thread: ThreadMessage[], limit = COPILOT.threadChars) {
  const label = (m: ThreadMessage) =>
    m.internal
      ? m.authorType === "system"
        ? "Flatdesk note (team only)"
        : `Internal note from ${m.name} (team only)`
      : m.authorType === "customer"
        ? `Customer (${m.name})`
        : m.authorType === "ai"
          ? "AI assistant, sent to the customer"
          : `Agent ${m.name}, sent to the customer`;
  const parts = thread.map((m) => `<message from="${label(m).replace(/"/g, "'")}">\n${m.body.slice(0, 6000)}\n</message>`);
  let total = parts.reduce((n, p) => n + p.length, 0);
  if (total <= limit) return parts.join("\n");
  // Keep the first message and as many of the latest as fit.
  const kept = [parts[0]];
  const tail: string[] = [];
  total = parts[0].length;
  for (let i = parts.length - 1; i > 0; i--) {
    if (total + parts[i].length > limit) break;
    tail.unshift(parts[i]);
    total += parts[i].length;
  }
  const skipped = parts.length - 1 - tail.length;
  return [...kept, `(${skipped} earlier message${skipped === 1 ? "" : "s"} left out)`, ...tail].join("\n");
}

async function loadThread(orgId: string, ticketId: string) {
  const ticket = await db.query.tickets.findFirst({ where: and(eq(tickets.orgId, orgId), eq(tickets.id, ticketId)) });
  if (!ticket) throw new CopilotError("That ticket doesn't exist.");
  const [customer, rows] = await Promise.all([
    db.query.customers.findFirst({ where: eq(customers.id, ticket.customerId) }),
    db
      .select({ id: messages.id, authorType: messages.authorType, internal: messages.internal, body: messages.body, authorName: messages.authorName, agentName: agents.name })
      .from(messages)
      .leftJoin(agents, and(eq(agents.orgId, messages.orgId), eq(agents.userId, messages.authorId)))
      .where(and(eq(messages.orgId, orgId), eq(messages.ticketId, ticketId)))
      .orderBy(asc(messages.createdAt)),
  ]);
  const customerName = customer?.name || customer?.email || "the customer";
  const thread: ThreadMessage[] = rows.map((m) => ({
    id: m.id,
    authorType: m.authorType,
    internal: m.internal,
    body: m.body,
    name: m.authorType === "customer" ? m.authorName || customerName : (m.agentName ?? m.authorName ?? "someone on the team"),
  }));
  return { ticket, customerName, thread };
}

async function settle(eventId: string, metered: Metered, extra: { output?: string; lastMessageId?: string } = {}) {
  await db.update(events).set({ ...metered, ...extra }).where(eq(events.id, eventId));
}

// ---- Summary ------------------------------------------------------------------

const Summary = z.object({
  points: z.array(z.string()).describe("2 to 4 short bullet points: what the customer wants, what has happened so far, and anything promised."),
  mood: z.enum(["calm", "confused", "frustrated", "angry"]).describe("How the customer comes across in their latest message."),
  next: z.string().describe("One sentence: the next thing the team should do."),
});
export type TicketSummary = z.infer<typeof Summary> & { at: string };

const SUMMARY_SYSTEM = `You brief a support agent who is about to pick up a ticket. Read the conversation and summarize it so they can act without reading it all. Be concrete: names, order numbers, dates and amounts that matter. Only state what the conversation says. Plain text, no markdown.`;

export function parseSummary(output: string | null): TicketSummary | null {
  if (!output) return null;
  try {
    const v = JSON.parse(output);
    return Array.isArray(v.points) && typeof v.next === "string" ? v : null;
  } catch {
    return null;
  }
}

// The latest summary for a ticket and whether the conversation has moved on since.
export async function cachedSummary(orgId: string, ticketId: string, lastMessageId: string | undefined) {
  const [row] = await db
    .select({ output: events.output, lastMessageId: events.lastMessageId })
    .from(events)
    .where(and(eq(events.orgId, orgId), eq(events.ticketId, ticketId), eq(events.kind, "summary"), isNotNull(events.output)))
    .orderBy(desc(events.createdAt))
    .limit(1);
  const summary = parseSummary(row?.output ?? null);
  return summary ? { summary, stale: row.lastMessageId !== (lastMessageId ?? null) } : null;
}

export async function summarizeTicket(orgId: string, userId: string, ticketId: string): Promise<TicketSummary> {
  const { ticket, thread } = await loadThread(orgId, ticketId);
  const last = thread.at(-1);
  const cached = await cachedSummary(orgId, ticketId, last?.id);
  if (cached && !cached.stale) return cached.summary; // free: nothing new to read
  const { eventId } = await reserveAction(orgId, userId, ticketId, "summary");
  const { out, metered } = await structuredCall(orgId, Summary, SUMMARY_SYSTEM, `Subject: ${ticket.subject}\n\n${threadText(thread)}`);
  if (!out) {
    await settle(eventId, metered);
    throw new CopilotError("The copilot couldn't summarize this ticket.");
  }
  const summary: TicketSummary = { points: out.points.slice(0, 4).map((p) => p.trim()).filter(Boolean), mood: out.mood, next: out.next.trim(), at: new Date().toISOString() };
  await settle(eventId, metered, { output: JSON.stringify(summary), lastMessageId: last?.id });
  return summary;
}

// ---- Drafted reply --------------------------------------------------------------

const Draft = z.object({
  reply: z.string().describe("The reply for the agent to review and send. Empty if the saved answers and notes don't cover it."),
  gaps: z.string().describe("One sentence on anything the agent must check or fill in before sending, or an empty string."),
});

function draftSystem(orgName: string, instructions: string, knowledge: { name: string; body: string }[]) {
  const kb = knowledge.map((m) => `<answer title="${m.name.replace(/"/g, "'")}">\n${m.body}\n</answer>`).join("\n");
  return `You draft the next reply in a support conversation for ${orgName}. An agent on the team will review and edit your draft before anything is sent.

Use the team's notes and saved answers below for facts, policies, links and steps. Never invent prices, policies, dates, links or promises: where the reply needs something you don't have (an order status, an account detail), write a square-bracket placeholder like [tracking link] and say so in gaps. Answer the customer's latest message, taking the whole conversation into account, including internal notes the customer never saw.

Write plain text, no markdown. Greet the customer by first name if you know it, keep it short, and sign off with the agent's name given above the conversation. Match the language the customer wrote in.

<team_notes>
${instructions.trim() || "(none)"}
</team_notes>

<saved_answers>
${kb || "(none)"}
</saved_answers>`;
}

export async function draftReply(orgId: string, userId: string, ticketId: string): Promise<{ reply: string; gaps: string }> {
  // A ticket from another team throws before anything is counted.
  const { ticket, thread } = await loadThread(orgId, ticketId);
  const { org, eventId } = await reserveAction(orgId, userId, ticket.id, "draft");
  const [knowledge, agent, [recent]] = await Promise.all([
    loadKnowledge(orgId),
    db.query.agents.findFirst({ where: and(eq(agents.orgId, orgId), eq(agents.userId, userId)) }),
    db
      .select({
        hour: sql<number>`count(*) filter (where ${events.createdAt} > now() - interval '1 hour')`,
        week: count(),
      })
      .from(events)
      .where(and(eq(events.orgId, orgId), eq(events.kind, "draft"), ne(events.id, eventId), sql`${events.createdAt} > now() - interval '7 days'`)),
  ]);
  const firstName = agent?.name.split(/\s+/)[0] || "the team";
  // The saved answers are cached by the same rule as AI answers' (worthCaching
  // in lib/ai.ts), so a lone draft doesn't pay twice for a cache nobody reads.
  // The agent's name stays out of the cached part so the whole team shares it.
  const text = draftSystem(org.name, org.aiInstructions, knowledge);
  const cache = Number(recent.hour) > 0 || Number(recent.week) >= CACHE_MIN_WEEKLY_CALLS;
  const system = cache ? [{ type: "text" as const, text, cache_control: { type: "ephemeral" as const, ttl: "1h" as const } }] : text;
  const { out, metered } = await structuredCall(orgId, Draft, system, `Agent's name: ${firstName}\nSubject: ${ticket.subject}\n\n${threadText(thread)}`);
  await settle(eventId, metered);
  if (!out?.reply.trim()) throw new CopilotError(out?.gaps?.trim() || "The copilot didn't have enough to draft this one. Your saved answers don't cover it yet.");
  return { reply: out.reply.trim(), gaps: out.gaps.trim() };
}

// ---- Rewrite --------------------------------------------------------------------

const Rewrite = z.object({ text: z.string().describe("The rewritten text.") });

export async function rewriteText(orgId: string, userId: string, ticketId: string | null, text: string, style: RewriteStyle): Promise<string> {
  const input = text.trim();
  if (!input) throw new CopilotError("Write something first, then the copilot can rewrite it.");
  if (input.length > 8000) throw new CopilotError("That's too long to rewrite in one go. Try a shorter part.");
  if (!Object.hasOwn(REWRITE_STYLES, style)) throw new CopilotError("Unknown rewrite style.");
  // Only this team's tickets are linked to the event.
  const ticket = ticketId ? await db.query.tickets.findFirst({ where: and(eq(tickets.orgId, orgId), eq(tickets.id, ticketId)), columns: { id: true } }) : null;
  const { eventId } = await reserveAction(orgId, userId, ticket?.id ?? null, "rewrite");
  const system = `You edit a support agent's reply before they send it. ${REWRITE_STYLES[style]} Keep square-bracket placeholders as they are. Keep the language it's written in. Plain text, no markdown. Return only the edited reply.`;
  const { out, metered } = await structuredCall(orgId, Rewrite, system, input);
  await settle(eventId, metered);
  if (!out?.text.trim()) throw new CopilotError("The copilot couldn't rewrite that.");
  return out.text.trim();
}

// For the overview page: this month's actions by kind.
export async function copilotBreakdown(orgId: string, month = monthKey()) {
  const rows = await db
    .select({ kind: events.kind, n: count() })
    .from(events)
    .where(and(eq(events.orgId, orgId), eq(events.month, month)))
    .groupBy(events.kind);
  const by = Object.fromEntries(rows.map((r) => [r.kind, Number(r.n)])) as Partial<Record<"summary" | "draft" | "rewrite" | "translate", number>>;
  return { summary: by.summary ?? 0, draft: by.draft ?? 0, rewrite: by.rewrite ?? 0, translate: by.translate ?? 0 };
}

// ---- Translate ------------------------------------------------------------------
// Customer messages in another language are translated into the team's when
// someone opens the ticket, and replies can go out in the customer's language.
// Each is one copilot action. Tickets nobody opens (the AI answered them)
// never cost a translation.

const Translations = z.object({
  items: z.array(z.object({ n: z.number().int().describe("The message's number."), text: z.string().describe("The translation.") })),
});

const KEEP = "Keep names, numbers, order numbers, links, email addresses and square-bracket placeholders exactly as they are. Keep line breaks. Plain text, no markdown.";

// Translates the ticket's customer messages that are in another language and
// not translated yet (the latest 10). Returns how many it translated.
export async function translateTicket(orgId: string, userId: string, ticketId: string): Promise<number> {
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, orgId), columns: { language: true } });
  if (!org) return 0;
  const rows = await db
    .select({ id: messages.id, body: messages.body })
    .from(messages)
    .where(and(eq(messages.orgId, orgId), eq(messages.ticketId, ticketId), eq(messages.authorType, "customer"), sql`${messages.translation} is null`))
    .orderBy(desc(messages.createdAt))
    .limit(10);
  const todo = rows.flatMap((m) => {
    const from = isForeign(m.body, org.language);
    return from ? [{ ...m, from, n: 0 }] : [];
  });
  if (!todo.length) return 0;
  todo.forEach((m, i) => (m.n = i + 1));
  const { eventId } = await reserveAction(orgId, userId, ticketId, "translate");
  const target = languageLabel(org.language);
  const system = `You translate messages that customers sent to a support team into ${target}, so the team can read them. ${KEEP} Translate every message; return one item per message with its number.`;
  const user = todo.map((m) => `[${m.n}]\n${m.body.slice(0, 6000)}`).join("\n\n");
  const { out, metered } = await structuredCall(orgId, Translations, system, user);
  await settle(eventId, metered);
  let done = 0;
  for (const item of out?.items ?? []) {
    const m = todo.find((t) => t.n === item.n);
    if (!m || !item.text.trim()) continue;
    await db.update(messages).set({ translation: item.text.trim(), translatedFrom: m.from }).where(and(eq(messages.orgId, orgId), eq(messages.id, m.id)));
    done++;
  }
  return done;
}

// An agent's reply in the customer's language, before it's sent.
export async function translateReply(orgId: string, userId: string, ticketId: string, text: string, to: string): Promise<string> {
  const input = text.trim();
  if (!input) throw new CopilotError("Write the reply first.");
  if (input.length > 8000) throw new CopilotError("That's too long to translate in one go.");
  if (!isLanguage(to)) throw new CopilotError("Unknown language.");
  const { eventId } = await reserveAction(orgId, userId, ticketId, "translate");
  const system = `You translate a support agent's reply into ${languageLabel(to)} before it goes to the customer. ${KEEP} Keep the tone. Return only the translation.`;
  const { out, metered } = await structuredCall(orgId, Rewrite, system, input);
  await settle(eventId, metered);
  if (!out?.text.trim()) throw new CopilotError("The reply couldn't be translated. Send it as written, or try again.");
  return out.text.trim();
}

// ---- Help center articles -------------------------------------------------------

// Long enough for nearly every article; the translation has to fit in one answer.
export const ARTICLE_TRANSLATE_CHARS = 12_000;
const ArticleText = z.object({ title: z.string().describe("The translated title."), section: z.string().describe("The translated section name, or empty when there is none."), body: z.string().describe("The translated article.") });

// A help center article in another language. One copilot action, no ticket.
export async function translateArticle(orgId: string, userId: string, article: { title: string; body: string; section: string | null }, to: string): Promise<{ title: string; body: string; section: string | null }> {
  if (!isLanguage(to)) throw new CopilotError("Unknown language.");
  if (article.body.length > ARTICLE_TRANSLATE_CHARS) throw new CopilotError(`Articles up to ${ARTICLE_TRANSLATE_CHARS.toLocaleString("en-US")} characters can be translated by the AI. Write this one's translation by hand, or split the article.`);
  const { eventId } = await reserveAction(orgId, userId, null, "translate");
  const system = `You translate a help center article into ${languageLabel(to)} for the company's customers. Keep the formatting marks exactly as they are: "## " and "### " headings, "- " and "1. " list items, **bold**, [link text](url) (translate the link text, never the url), and blank lines between paragraphs. Keep product names, button and menu names as they appear in the product, numbers, prices, email addresses and links unchanged. Write naturally, as a native speaker on the company's support team would.`;
  const { out, metered } = await structuredCall(orgId, ArticleText, system, `Title: ${article.title}\nSection: ${article.section ?? ""}\n\n${article.body}`, { timeout: 150_000, maxRetries: 1 });
  await settle(eventId, metered);
  if (!out?.title.trim() || !out.body.trim()) throw new CopilotError("The article couldn't be translated. Try again.");
  return { title: out.title.trim().slice(0, 200), body: out.body.trim(), section: article.section ? out.section.trim().slice(0, 80) || null : null };
}
