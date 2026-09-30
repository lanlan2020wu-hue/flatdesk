// AI macros, step two: writing. lib/macro-suggestions.ts identifies the
// answers a team keeps sending. Here the AI reads the variants the team
// actually sent, and the tickets they answered, and writes one clean macro:
// a short name, the customer question it answers, and a reply with
// placeholders where each customer's details go. The question is what the
// ticket page uses to identify new tickets the macro fits.
//
// We pay for these calls. They never count toward a team's AI allowance or
// show on receipts. Each group of repeats is written once and cached, and a
// team gets at most WRITER.perDay written a day.

import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { aiConfigured } from "@/lib/ai";
import { structuredCall } from "@/lib/llm";
import { applyDrift, type Drift, type MacroUpdate } from "@/lib/macro-drift";
import type { Suggestion } from "@/lib/macro-suggestions";

export const WRITER = { perDay: 12, perRun: 3 };

const { macroAiDrafts: drafts } = schema;

const Written = z.object({
  name: z.string().describe("A short macro name, 2 to 6 words, like 'Refund timing' or 'Reset a password'."),
  question: z.string().describe("The customer question this reply answers, as one plain sentence in the customer's words."),
  body: z.string().describe("The macro reply, ready to send."),
});

export const WRITER_SYSTEM = `You turn answers a support team keeps retyping into one reusable macro.

You get several replies the team sent to different customers, with the subject of each ticket. They say essentially the same thing. Write:
- name: a short label an agent would look for in a list
- question: the question customers are asking when this is the answer, in plain words
- body: one reply that covers what the variants have in common

Rules for the body:
- Start with "Hi [customer name]," and end with a short sign-off line and no name, so anyone on the team can send it.
- Put square-bracket placeholders like [order number] or [date] wherever the variants differ per customer. Never copy one customer's details.
- Keep every fact, link, price, time frame and step the variants agree on. Never add facts that aren't in them. Where variants disagree, use the most recent one (they're listed newest first).
- Plain text, no markdown. Write in the language the variants are written in.`;

export function writerPrompt(samples: Suggestion["samples"]) {
  return samples
    .map((s, i) => `<reply n="${i + 1}"${s.subject ? ` ticket_subject="${s.subject.replace(/"/g, "'").slice(0, 200)}"` : ""}>\n${s.answer}\n</reply>`)
    .join("\n");
}

// Tidy what the model wrote: bounded lengths, no stray markdown bold.
export function cleanWritten(w: z.infer<typeof Written>) {
  const name = w.name.replace(/[*_#`]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  const question = w.question.replace(/\s+/g, " ").trim().slice(0, 300);
  const body = w.body.replace(/\*\*(.+?)\*\*/g, "$1").trim().slice(0, 4000);
  return name && question && body ? { name, question, body } : null;
}

// Suggestions with the AI's version swapped in where it has been written.
// Returns the ones still waiting so the caller can have them written.
export async function withAiDrafts(orgId: string, suggestions: Suggestion[]) {
  if (!suggestions.length) return { suggestions, missing: [] as Suggestion[] };
  const rows = await db
    .select()
    .from(drafts)
    .where(and(eq(drafts.orgId, orgId), inArray(drafts.key, suggestions.map((s) => s.key))));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const merged = suggestions.map((s) => {
    const d = byKey.get(s.key);
    return d ? { ...s, name: d.name, body: d.body, question: d.question, aiWritten: true } : s;
  });
  return { suggestions: merged, missing: merged.filter((s) => !s.aiWritten) };
}

// Has the AI write up to WRITER.perRun waiting suggestions. Runs after the
// response (Next's after()), so it never slows a page. Never throws.
export async function writeMissingDrafts(orgId: string, missing: Suggestion[]) {
  if (!aiConfigured() || !missing.length) return 0;
  try {
    const since = new Date(Date.now() - 86_400_000);
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)` })
      .from(drafts)
      .where(and(eq(drafts.orgId, orgId), gte(drafts.createdAt, since)));
    const room = Math.min(WRITER.perRun, WRITER.perDay - Number(n));
    let written = 0;
    for (const s of missing.slice(0, Math.max(0, room))) {
      const { out, metered } = await structuredCall(Written, WRITER_SYSTEM, writerPrompt(s.samples));
      const clean = out && cleanWritten(out);
      if (!clean) continue;
      await db
        .insert(drafts)
        .values({ orgId, key: s.key, ...clean, model: metered.model, costUsd: metered.costUsd })
        .onConflictDoNothing();
      written++;
    }
    return written;
  } catch (err) {
    console.error("AI macro writing failed", err);
    return 0;
  }
}

// ---- Macros that fix themselves ----------------------------------------------
// lib/macro-drift.ts finds the edit a team keeps making to a macro. The AI
// rewrites the macro with that edit, keeping its placeholders, and the result
// is cached per macro and edit. It shares the daily limit above.

const Updated = z.object({ body: z.string().describe("The whole macro, rewritten with the team's edits, ready to send.") });

export const UPDATE_SYSTEM = `You update a support macro to match how the team actually sends it.

You get the current macro and the edits agents keep making to it before sending: sentences they delete, sentences they reword, and sentences they add. Rewrite the macro so it includes those edits and nothing else.

Rules:
- Keep the greeting, sign-off and every [placeholder] from the current macro. Where an added or reworded sentence contains one customer's details (a name, an order number, a date), use a placeholder instead.
- Change nothing the edits don't cover.
- Plain text, no markdown, same language as the macro.`;

export function updatePrompt(macroBody: string, drift: Drift) {
  const lines = [
    ...drift.removed.map((r) => `- Deleted on ${r.count} of ${drift.uses} sends: "${r.text}"`),
    ...drift.changed.map((c) => `- Reworded on ${c.count} of ${drift.uses} sends: "${c.from}" became "${c.to}"`),
    ...drift.added.map((a) => `- Added on ${a.count} of ${drift.uses} sends${a.after ? ` after "${a.after}"` : " near the top"}: "${a.text}"`),
  ];
  return `<current_macro>\n${macroBody}\n</current_macro>\n\n<team_edits>\n${lines.join("\n")}\n</team_edits>`;
}

const updateKey = (u: MacroUpdate) => `update:${u.macro.id}:${u.drift.signature}`;

// Each update with the proposed text: the AI's, once written, or the edits
// applied mechanically until then.
export async function withUpdateDrafts(orgId: string, updates: MacroUpdate[]) {
  if (!updates.length) return { updates: [] as (MacroUpdate & { proposed: string; aiWritten: boolean })[], missing: [] as MacroUpdate[] };
  const rows = await db
    .select()
    .from(drafts)
    .where(and(eq(drafts.orgId, orgId), inArray(drafts.key, updates.map(updateKey))));
  const byKey = new Map(rows.map((r) => [r.key, r.body]));
  const merged = updates.map((u) => {
    const body = byKey.get(updateKey(u));
    return { ...u, proposed: body ?? applyDrift(u.macro.body, u.drift), aiWritten: !!body };
  });
  return { updates: merged, missing: merged.filter((u) => !u.aiWritten) };
}

// Has the AI rewrite up to WRITER.perRun outdated macros. Never throws.
export async function writeMacroUpdates(orgId: string, missing: MacroUpdate[]) {
  if (!aiConfigured() || !missing.length) return 0;
  try {
    const since = new Date(Date.now() - 86_400_000);
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)` })
      .from(drafts)
      .where(and(eq(drafts.orgId, orgId), gte(drafts.createdAt, since)));
    const room = Math.min(WRITER.perRun, WRITER.perDay - Number(n));
    let written = 0;
    for (const u of missing.slice(0, Math.max(0, room))) {
      const { out, metered } = await structuredCall(Updated, UPDATE_SYSTEM, updatePrompt(u.macro.body, u.drift));
      const body = out?.body.replace(/\*\*(.+?)\*\*/g, "$1").trim().slice(0, 4000);
      if (!body) continue;
      await db
        .insert(drafts)
        .values({ orgId, key: updateKey(u), name: u.macro.name, question: "", body, model: metered.model, costUsd: metered.costUsd })
        .onConflictDoNothing();
      written++;
    }
    return written;
  } catch (err) {
    console.error("AI macro update failed", err);
    return 0;
  }
}
