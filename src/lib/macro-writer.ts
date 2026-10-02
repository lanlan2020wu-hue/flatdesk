// AI macros, step two: writing. lib/macro-suggestions.ts identifies the
// answers a team keeps sending. Here the AI reads the variants the team
// actually sent, and the tickets they answered, and writes one clean macro:
// a short name, the customer question it answers, and a reply with
// placeholders where each customer's details go. The question is what the
// ticket page uses to identify new tickets the macro fits.
//
// We pay for these calls. They never count toward a team's AI allowance or
// show on receipts. Each group of repeats is written once and cached, and a
// team gets at most WRITER.perDay calls a day, failed ones included.
//
// Opening the Macros page starts the writing, so two tabs or a quick reload
// must not start the same calls twice. A run claims each key first, under a
// per-team lock, by saving a placeholder row (empty body, model "pending").
// The call fills it in. A failed call leaves it as "failed:N" and is tried
// again after a day, at most WRITER.maxAttempts times in all.

import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { aiConfigured } from "@/lib/ai";
import { structuredCall } from "@/lib/llm";
import { applyDrift, type Drift, type MacroUpdate } from "@/lib/macro-drift";
import type { Suggestion } from "@/lib/macro-suggestions";

export const WRITER = { perDay: 12, perRun: 3, maxAttempts: 3 };

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
    .where(and(eq(drafts.orgId, orgId), inArray(drafts.key, suggestions.map((s) => s.key)), ne(drafts.body, "")));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const merged = suggestions.map((s) => {
    const d = byKey.get(s.key);
    return d ? { ...s, name: d.name, body: d.body, question: d.question, aiWritten: true } : s;
  });
  return { suggestions: merged, missing: merged.filter((s) => !s.aiWritten) };
}

const PENDING = "pending";
const failedCount = (model: string) => (model.startsWith("failed:") ? Number(model.slice(7)) || 0 : 0);

// Claims up to WRITER.perRun of `keys` for this run, oldest wishes first.
// Returns the claimed keys. Every claim counts toward the day's limit. Done
// in one short transaction under a per-team lock, so concurrent runs never
// claim the same key or go past the limit together.
export async function claimKeys(orgId: string, keys: { key: string; name: string }[]) {
  if (!keys.length) return [] as string[];
  return db.transaction(async (tx) => {
    const [{ locked }] = (await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext(${`macro-writer:${orgId}`})) as locked`)).rows;
    if (!locked) return []; // another run is claiming right now
    const since = new Date(Date.now() - 86_400_000);
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)` })
      .from(drafts)
      .where(and(eq(drafts.orgId, orgId), gte(drafts.createdAt, since)));
    let room = Math.min(WRITER.perRun, WRITER.perDay - Number(n));
    if (room <= 0) return [];
    const existing = new Map(
      (
        await tx
          .select({ key: drafts.key, body: drafts.body, model: drafts.model, createdAt: drafts.createdAt })
          .from(drafts)
          .where(and(eq(drafts.orgId, orgId), inArray(drafts.key, keys.map((k) => k.key))))
      ).map((r) => [r.key, r]),
    );
    const claimed: string[] = [];
    for (const k of keys) {
      if (room <= 0) break;
      const row = existing.get(k.key);
      if (!row) {
        await tx.insert(drafts).values({ orgId, key: k.key, name: k.name.slice(0, 80) || "Macro", question: "", body: "", model: PENDING }).onConflictDoNothing();
      } else {
        // Written already, being written, or failed too often or too recently.
        if (row.body || failedCount(row.model) >= WRITER.maxAttempts || row.createdAt >= since) continue;
        // A failed try (or a run that died mid-call) from over a day ago: try again.
        await tx.update(drafts).set({ createdAt: new Date() }).where(and(eq(drafts.orgId, orgId), eq(drafts.key, k.key)));
      }
      claimed.push(k.key);
      room--;
    }
    return claimed;
  });
}

async function fill(orgId: string, key: string, values: { name?: string; question?: string; body: string; model: string; costUsd: string }) {
  await db
    .update(drafts)
    .set(values)
    .where(and(eq(drafts.orgId, orgId), eq(drafts.key, key), eq(drafts.body, "")));
}

// Marks a claimed key as failed once more, keeping the cost of the try.
async function fail(orgId: string, key: string, costUsd = "0") {
  await db
    .update(drafts)
    .set({
      model: sql`'failed:' || (case when ${drafts.model} like 'failed:%' then substr(${drafts.model}, 8)::int else 0 end + 1)`,
      costUsd: sql`${drafts.costUsd} + ${costUsd}`,
    })
    .where(and(eq(drafts.orgId, orgId), eq(drafts.key, key), eq(drafts.body, "")));
}

// Runs the AI call for each claimed key. A call that throws or returns
// nothing usable marks its key failed; the rest carry on. Never throws.
async function runClaimed<T>(orgId: string, claimed: string[], items: Map<string, T>, call: (item: T) => Promise<{ values: { name?: string; question?: string; body: string } | null; metered: { model: string; costUsd: string } }>) {
  let written = 0;
  for (const key of claimed) {
    const item = items.get(key);
    if (!item) continue;
    try {
      const { values, metered } = await call(item);
      if (!values) {
        await fail(orgId, key, metered.costUsd);
        continue;
      }
      await fill(orgId, key, { ...values, model: metered.model, costUsd: metered.costUsd });
      written++;
    } catch (err) {
      console.error("AI macro writing failed", err);
      await fail(orgId, key).catch(() => {});
    }
  }
  return written;
}

// Has the AI write up to WRITER.perRun waiting suggestions. Runs after the
// response (Next's after()), so it never slows a page. Never throws.
export async function writeMissingDrafts(orgId: string, missing: Suggestion[]) {
  if (!aiConfigured() || !missing.length) return 0;
  try {
    const claimed = await claimKeys(orgId, missing.map((s) => ({ key: s.key, name: s.name })));
    return await runClaimed(orgId, claimed, new Map(missing.map((s) => [s.key, s])), async (s) => {
      const { out, metered } = await structuredCall(Written, WRITER_SYSTEM, writerPrompt(s.samples));
      return { values: (out && cleanWritten(out)) || null, metered };
    });
  } catch (err) {
    console.error("AI macro writing failed", err);
    return 0;
  }
}

// ---- Evolving macros ----------------------------------------------
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
    .where(and(eq(drafts.orgId, orgId), inArray(drafts.key, updates.map(updateKey)), ne(drafts.body, "")));
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
    const claimed = await claimKeys(orgId, missing.map((u) => ({ key: updateKey(u), name: u.macro.name })));
    return await runClaimed(orgId, claimed, new Map(missing.map((u) => [updateKey(u), u])), async (u) => {
      const { out, metered } = await structuredCall(Updated, UPDATE_SYSTEM, updatePrompt(u.macro.body, u.drift));
      const body = out?.body.replace(/\*\*(.+?)\*\*/g, "$1").trim().slice(0, 4000);
      return { values: body ? { body } : null, metered };
    });
  } catch (err) {
    console.error("AI macro update failed", err);
    return 0;
  }
}
