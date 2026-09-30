// AI macros, step one: identification. Flatdesk looks at the replies agents
// actually send, finds answers the team keeps typing out (MIN_REPEATS or more
// times, on different tickets), and offers each one as a macro. The AI then
// writes each one up (lib/macro-writer.ts), and identifyMacro below matches
// new tickets to the macro that answers them.
//
// Finding the repeats is plain text matching in our own database, so it's
// fast on every page load. Imported history counts too, which is why a team
// that just moved from another help desk gets suggestions on day one. None of
// it touches the AI allowance.

import { and, desc, eq, gte } from "drizzle-orm";
import { db, schema } from "@/db";

export const MIN_REPEATS = 5; // distinct tickets with the same answer
export const LOOKBACK_DAYS = 90;
const SIMILAR = 0.5; // Jaccard similarity of content words
const MIN_WORDS = 6; // shorter replies ("Thanks, closing this") aren't worth a macro
const MAX_REPLIES = 2000;
const MAX_SUGGESTIONS = 6;
const SAMPLES = 6; // variants the AI reads when it writes the macro

// Common words carry no meaning for matching; leaving them in makes unrelated replies look alike.
const STOP = new Set(
  (
    "a an and are as at be been but by can could did do does for from had has have he her here hi hello hey his how i if in " +
    "into is it its just let me my no not of on or our please so that the their them then there these they this to too " +
    "us was we were what when where which who will with would you your yours thanks thank best regards cheers team"
  ).split(" "),
);

const GREETING = /^(hi|hello|hey|dear|good (morning|afternoon|evening))\b[^\n]{0,40}$/i;
const SIGN_OFF = /^(thanks|thank you|many thanks|best|best regards|kind regards|regards|cheers|all the best|warmly|sincerely)\b[^\n]{0,30}$/i;

// The part of a reply that is the agent's own answer: no quoted email below
// it, no greeting line above it, no sign-off and name after it.
export function answerPart(body: string): string {
  let lines = body.replace(/\r\n?/g, "\n").split("\n");
  const quote = lines.findIndex((l) => /^\s*>/.test(l) || /^On .{4,120} wrote:\s*$/.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l.trim()));
  if (quote >= 0) lines = lines.slice(0, quote);
  lines = lines.map((l) => l.trimEnd());
  while (lines.length && !lines[0].trim()) lines.shift();
  if (lines.length && GREETING.test(lines[0].trim())) lines.shift();
  const signOff = lines.findLastIndex((l) => SIGN_OFF.test(l.trim()));
  if (signOff >= 0 && lines.length - signOff <= 4) lines = lines.slice(0, signOff);
  return lines.join("\n").trim();
}

export function words(text: string): Set<string> {
  const normalized = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " link ")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, " email ")
    .replace(/\d[\d,.:/-]*/g, " 0 ");
  const out = new Set<string>();
  for (const w of normalized.split(/[^a-z0-9']+/)) {
    const t = w.replace(/^'+|'+$/g, "").replace(/'s$/, "");
    if (t.length > 1 && !STOP.has(t)) out.add(t);
    else if (t === "0") out.add(t);
  }
  return out;
}

export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const w of small) if (big.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

// The macro text: the most typical reply, with the customer's name in the
// greeting and long numbers (order ids, amounts) swapped for placeholders.
export function macroBody(body: string): string {
  let lines = body.replace(/\r\n?/g, "\n").split("\n");
  const quote = lines.findIndex((l) => /^\s*>/.test(l) || /^On .{4,120} wrote:\s*$/.test(l.trim()));
  if (quote >= 0) lines = lines.slice(0, quote);
  lines = lines.map((l) => l.trimEnd());
  while (lines.length && !lines[0].trim()) lines.shift();
  if (lines.length && GREETING.test(lines[0].trim())) {
    const greet = lines[0].trim().match(/^(hi|hello|hey|dear|good (?:morning|afternoon|evening))/i)![1];
    lines[0] = `${greet} there,`;
  }
  // Drop the agent's name under the sign-off so the macro fits anyone on the team.
  const signOff = lines.findLastIndex((l) => SIGN_OFF.test(l.trim()));
  if (signOff >= 0 && lines.length - signOff <= 4) lines = lines.slice(0, signOff + 1);
  return lines
    .join("\n")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]")
    .replace(/(?<![\w/.-])[#$€£]?\d[\d,]{3,}(?:\.\d+)?(?![\w/])/g, "[number]")
    .trim();
}

// A short name for the macro: the start of the answer's first sentence, cut
// at a word and without a dangling "within 5" or "to the".
const DANGLING = new Set([...STOP, "0", "about", "after", "before", "by", "during", "over", "under", "until", "within", "via", "per"]);
export function macroName(answer: string): string {
  const first = answer.split(/(?<=[.!?])\s|\n/)[0].replace(/[.!?:,;]+$/, "").trim();
  if (first.length <= 44) return first || "Saved reply";
  const kept = first.slice(0, 45).split(/\s+/).slice(0, -1);
  while (kept.length > 3 && DANGLING.has(kept.at(-1)!.toLowerCase().replace(/\d+/g, "0").replace(/[^a-z0-9]/g, ""))) kept.pop();
  return kept.join(" ").replace(/[,;:]+$/, "");
}

export type Reply = {
  id: string;
  ticketId: string;
  ticketNumber: number;
  body: string;
  createdAt: Date;
  tags?: string[];
  subject?: string;
};

export type Suggestion = {
  key: string; // id of the representative reply
  name: string;
  body: string;
  answer: string; // cleaned text, stored if the suggestion is dismissed
  addTags: string[];
  tickets: number; // distinct tickets that got this answer
  thisWeek: number;
  examples: number[]; // ticket numbers, newest first
  lastSentAt: Date;
  // What the AI reads to write the macro: the variants the team sent, with the
  // subject of the ticket each one answered. One per ticket, newest first.
  samples: { subject: string; answer: string }[];
  question: string | null; // the customer question, once the AI has written the macro
  aiWritten: boolean;
};

type Item = Reply & { answer: string; words: Set<string> };

function prepare(replies: Reply[]): Item[] {
  const items: Item[] = [];
  for (const r of replies) {
    const answer = answerPart(r.body);
    const w = words(answer);
    if (w.size >= MIN_WORDS) items.push({ ...r, answer, words: w });
  }
  return items;
}

// Group replies that say the same thing. Leader clustering: each reply joins
// the first group whose seed it closely matches, or starts a new group. Fast
// enough for a few thousand replies on a page load, and stable because the
// input is always newest first.
export function suggestMacros(
  replies: Reply[],
  opts: { covered?: string[]; now?: Date; minRepeats?: number; limit?: number } = {},
): Suggestion[] {
  const now = opts.now ?? new Date();
  const minRepeats = opts.minRepeats ?? MIN_REPEATS;
  const covered = (opts.covered ?? []).map((t) => words(answerPart(t))).filter((w) => w.size > 0);
  const items = prepare([...replies].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));

  const groups: { seed: Set<string>; members: Item[] }[] = [];
  // Word -> groups whose seed has it, so each reply is only compared with
  // groups it shares words with.
  const index = new Map<string, number[]>();
  const counts = new Int32Array(items.length);
  const touched: number[] = [];
  for (const it of items) {
    for (const w of it.words) {
      for (const g of index.get(w) ?? []) {
        if (counts[g]++ === 0) touched.push(g);
      }
    }
    let best = -1;
    let bestScore = SIMILAR;
    for (const g of touched) {
      const n = counts[g];
      const score = n / (it.words.size + groups[g].seed.size - n);
      if (score > bestScore || (score === bestScore && (best < 0 || g < best))) {
        best = g;
        bestScore = score;
      }
      counts[g] = 0;
    }
    touched.length = 0;
    if (best >= 0) groups[best].members.push(it);
    else {
      const id = groups.push({ seed: it.words, members: [it] }) - 1;
      for (const w of it.words) {
        const list = index.get(w);
        if (list) list.push(id);
        else index.set(w, [id]);
      }
    }
  }

  const weekAgo = now.getTime() - 7 * 86_400_000;
  const out: Suggestion[] = [];
  for (const g of groups) {
    const tickets = new Set(g.members.map((m) => m.ticketId));
    if (tickets.size < minRepeats) continue;
    // Already a macro, or dismissed before: skip.
    if (covered.some((c) => similarity(c, g.seed) >= SIMILAR)) continue;

    // The most typical member becomes the macro (sample to keep it cheap).
    const sample = g.members.slice(0, 40);
    let rep = sample[0];
    let repScore = -1;
    for (const m of sample) {
      let total = 0;
      for (const o of sample) if (o !== m) total += similarity(m.words, o.words);
      if (total > repScore) {
        rep = m;
        repScore = total;
      }
    }

    // Tags most of these tickets share are probably what the macro should add.
    const tagCounts = new Map<string, number>();
    const seenTicket = new Set<string>();
    for (const m of g.members) {
      if (seenTicket.has(m.ticketId)) continue;
      seenTicket.add(m.ticketId);
      for (const t of m.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    }
    const addTags = [...tagCounts].filter(([, n]) => n / tickets.size >= 0.6).map(([t]) => t).slice(0, 3);

    const examples: number[] = [];
    for (const m of g.members) if (!examples.includes(m.ticketNumber) && examples.length < 5) examples.push(m.ticketNumber);
    const samples: Suggestion["samples"] = [];
    const sampled = new Set<string>();
    for (const m of g.members) {
      if (sampled.has(m.ticketId) || samples.length >= SAMPLES) continue;
      sampled.add(m.ticketId);
      samples.push({ subject: m.subject ?? "", answer: m.answer.slice(0, 1500) });
    }

    out.push({
      key: rep.id,
      name: macroName(rep.answer),
      body: macroBody(rep.body),
      answer: rep.answer,
      addTags,
      tickets: tickets.size,
      thisWeek: new Set(g.members.filter((m) => m.createdAt.getTime() >= weekAgo).map((m) => m.ticketId)).size,
      examples,
      lastSentAt: g.members[0].createdAt,
      samples,
      question: null,
      aiWritten: false,
    });
  }
  return out.sort((a, b) => b.tickets - a.tickets || b.lastSentAt.getTime() - a.lastSentAt.getTime()).slice(0, opts.limit ?? MAX_SUGGESTIONS);
}

// How many other tickets already got this same answer, when it isn't a macro
// yet. Drives the "save this as a macro?" prompt right after an agent replies.
export function repeatsOf(body: string, replies: Reply[], opts: { covered?: string[] } = {}): number {
  const w = words(answerPart(body));
  if (w.size < MIN_WORDS) return 0;
  const covered = (opts.covered ?? []).map((t) => words(answerPart(t)));
  if (covered.some((c) => similarity(c, w) >= SIMILAR)) return 0;
  const tickets = new Set<string>();
  for (const it of prepare(replies)) if (similarity(it.words, w) >= SIMILAR) tickets.add(it.ticketId);
  return tickets.size;
}

// Which saved macro answers this customer's message, if one clearly does. The
// AI wrote each suggested macro's question from the tickets it came from, so a
// new ticket asking the same thing shares most of its words. Macros without a
// question are matched on their name, more strictly.
export function identifyMacro<M extends { id: string; name: string; question: string | null }>(message: string, macros: M[]): M | null {
  const asked = words(answerPart(message));
  if (asked.size < 2) return null;
  let best: M | null = null;
  let bestScore = 0;
  for (const m of macros) {
    const target = words(m.question || m.name);
    if (target.size < 2) continue;
    let shared = 0;
    for (const w of target) if (asked.has(w)) shared++;
    // Most of the macro's question should appear in the message.
    const score = shared / target.size;
    const needed = m.question ? 0.5 : 0.75;
    if (shared >= 2 && score >= needed && score > bestScore) {
      best = m;
      bestScore = score;
    }
  }
  return best;
}

// ---- Database ---------------------------------------------------------------

async function loadReplies(orgId: string, now: Date): Promise<Reply[]> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
  const { messages, tickets } = schema;
  const rows = await db
    .select({
      id: messages.id,
      ticketId: messages.ticketId,
      ticketNumber: tickets.number,
      body: messages.body,
      createdAt: messages.createdAt,
      tags: tickets.tags,
      subject: tickets.subject,
    })
    .from(messages)
    .innerJoin(tickets, eq(tickets.id, messages.ticketId))
    .where(and(eq(messages.orgId, orgId), eq(messages.authorType, "agent"), eq(messages.internal, false), gte(messages.createdAt, since)))
    .orderBy(desc(messages.createdAt))
    .limit(MAX_REPLIES);
  return rows;
}

// Existing macro bodies and dismissed answers: nothing similar is suggested.
async function coveredTexts(orgId: string): Promise<string[]> {
  const [macros, dismissed] = await Promise.all([
    db.select({ body: schema.macros.body }).from(schema.macros).where(eq(schema.macros.orgId, orgId)),
    db.select({ text: schema.macroSuggestionDismissals.text }).from(schema.macroSuggestionDismissals).where(eq(schema.macroSuggestionDismissals.orgId, orgId)),
  ]);
  return [...macros.map((m) => m.body), ...dismissed.map((d) => d.text)];
}

export async function macroSuggestions(orgId: string, now = new Date()): Promise<Suggestion[]> {
  const [replies, covered] = await Promise.all([loadReplies(orgId, now), coveredTexts(orgId)]);
  return suggestMacros(replies, { covered, now });
}

// For the ticket page: if the agent's latest reply on this ticket (sent in
// the last hour) is an answer they keep repeating, how many tickets have had it.
export async function repeatPrompt(orgId: string, ticketId: string, reply: { id: string; body: string; createdAt: Date }, now = new Date()) {
  if (now.getTime() - reply.createdAt.getTime() > 3_600_000) return null;
  const [replies, covered] = await Promise.all([loadReplies(orgId, now), coveredTexts(orgId)]);
  const others = replies.filter((r) => r.id !== reply.id && r.ticketId !== ticketId);
  const count = repeatsOf(reply.body, others, { covered });
  if (count + 1 < MIN_REPEATS) return null;
  const answer = answerPart(reply.body);
  return { tickets: count + 1, name: macroName(answer), body: macroBody(reply.body), answer };
}

export async function dismissSuggestion(orgId: string, userId: string, text: string) {
  const answer = answerPart(text).slice(0, 4000);
  if (!answer) return;
  await db.insert(schema.macroSuggestionDismissals).values({ orgId, text: answer, dismissedBy: userId });
}

// Saves the macro and remembers the answer it came from: the AI's version is
// reworded, so without it the same repeats would be suggested again.
export async function saveSuggestedMacro(
  orgId: string,
  values: { name: string; body: string; addTags: string[]; question?: string | null },
  from?: { answer: string; userId: string },
) {
  const [macro] = await db
    .insert(schema.macros)
    .values({ orgId, name: values.name, body: values.body, addTags: values.addTags, question: values.question || null, source: "suggested" })
    .returning({ id: schema.macros.id });
  if (from?.answer) await dismissSuggestion(orgId, from.userId, from.answer);
  return macro;
}
