// AI macros, step three: evolving macros. When an agent inserts a
// macro, the reply records which macro it started from and the macro's text
// at that moment. If the team keeps making the same edit before sending (a
// sentence added, one deleted, a time frame changed), the macro is out of
// date. Flatdesk spots the edit here, with no model call, and the AI then
// rewrites the macro with the change (lib/macro-writer.ts) for an admin to
// apply in one click.
//
// Only uses since the macro last changed count, so applying an update starts
// the count again from zero.

import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { answerPart, similarity, words } from "@/lib/macro-suggestions";
import { isUuid } from "@/lib/ids";

export const DRIFT = {
  minUses: 3, // sends of the current version before an edit can count
  share: 0.6, // an edit must show up in at least this share of those sends
  recent: 20, // the most recent sends read per macro
  match: 0.5, // content-word similarity for "this is that sentence, edited"
  same: 0.7, // similarity for two agents' versions to be the same edit
  minAddedWords: 3, // shorter added lines are names and pleasantries
};

// Sentences and short lines, in order.
export function sentences(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9["'(])/))
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|\\]/g, "\\$&");

// A macro sentence as a pattern: placeholders like [order number] match
// whatever the agent filled in, spacing and case are ignored.
function pattern(sentence: string) {
  const parts = sentence.split(/\[[^\]]{1,60}\]/g).map((p) => escape(p).replace(/\s+/g, "\\s+").replace(/\[/g, "\\["));
  return new RegExp(`^${parts.join(".{1,80}?")}$`, "i");
}

// Tokens that keep numbers as they are, so "5 business days" and
// "7 business days" count as different versions.
function exact(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 || /\d/.test(t)));
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

export type UseDiff = {
  removed: number[]; // indexes of macro sentences the agent deleted
  changed: { at: number; to: string }[]; // macro sentences the agent reworded
  added: { after: number; text: string }[]; // new sentences, after macro sentence `after` (-1 = at the top)
};

// What one agent changed in one send, sentence by sentence.
export function diffUse(macroBody: string, sentBody: string): UseDiff {
  const base = sentences(answerPart(macroBody));
  const sent = sentences(answerPart(sentBody));
  const patterns = base.map(pattern);
  const baseWords = base.map((s) => words(s.replace(/\[[^\]]*\]/g, " ")));
  const matched = new Map<number, number>(); // macro sentence -> sent sentence
  const unchanged = new Set<number>();
  // Exact matches first (placeholders filled in), then close ones, in order.
  let from = 0;
  base.forEach((_, i) => {
    for (let j = from; j < sent.length; j++) {
      if (patterns[i].test(sent[j])) {
        matched.set(i, j);
        unchanged.add(i);
        from = j + 1;
        return;
      }
    }
  });
  const taken = new Set(matched.values());
  base.forEach((_, i) => {
    if (matched.has(i)) return;
    const lo = Math.max(-1, ...[...matched].filter(([k]) => k < i).map(([, j]) => j));
    const hi = Math.min(sent.length, ...[...matched].filter(([k]) => k > i).map(([, j]) => j));
    let best = -1;
    let score = DRIFT.match;
    for (let j = lo + 1; j < hi; j++) {
      if (taken.has(j)) continue;
      const s = similarity(baseWords[i], words(sent[j]));
      if (s >= score) [best, score] = [j, s];
    }
    if (best >= 0) {
      matched.set(i, best);
      taken.add(best);
    }
  });
  const diff: UseDiff = { removed: [], changed: [], added: [] };
  base.forEach((_, i) => {
    if (!matched.has(i)) diff.removed.push(i);
    else if (!unchanged.has(i)) diff.changed.push({ at: i, to: sent[matched.get(i)!] });
  });
  const bySent = new Map([...matched].map(([i, j]) => [j, i]));
  let after = -1;
  sent.forEach((text, j) => {
    if (bySent.has(j)) after = bySent.get(j)!;
    else if (text.split(/\s+/).length >= DRIFT.minAddedWords) diff.added.push({ after, text });
  });
  return diff;
}

export type Drift = {
  uses: number;
  removed: { text: string; count: number }[];
  changed: { from: string; to: string; count: number }[];
  added: { text: string; after: string | null; count: number }[];
  signature: string;
};

// Groups similar versions from different sends; returns the biggest group.
function commonest<T extends { text: string }>(items: T[]): T[] {
  const groups: T[][] = [];
  for (const it of items) {
    const w = exact(it.text);
    const g = groups.find((g) => jaccard(exact(g[0].text), w) >= DRIFT.same);
    if (g) g.push(it);
    else groups.push([it]);
  }
  return groups.sort((a, b) => b.length - a.length)[0] ?? [];
}

// The edits the team keeps making to one macro. `sends` are the reply bodies,
// newest first, all sent from the macro's current text. Null when there is no
// consistent edit.
export function macroDrift(macroBody: string, sends: string[]): Drift | null {
  if (sends.length < DRIFT.minUses) return null;
  const need = Math.max(DRIFT.minUses, Math.ceil(sends.length * DRIFT.share));
  const base = sentences(answerPart(macroBody));
  const diffs = sends.map((s) => diffUse(macroBody, s));
  const drift: Drift = { uses: sends.length, removed: [], changed: [], added: [], signature: "" };

  base.forEach((text, i) => {
    const removed = diffs.filter((d) => d.removed.includes(i)).length;
    if (removed >= need) return drift.removed.push({ text, count: removed });
    // Newest first, so the representative is the latest wording.
    const versions = diffs.flatMap((d) => d.changed.filter((c) => c.at === i).map((c) => ({ text: c.to })));
    const top = commonest(versions);
    if (top.length >= need) drift.changed.push({ from: text, to: top[0].text, count: top.length });
  });

  // Added sentences, counted once per send.
  const added = diffs.flatMap((d, n) => d.added.map((a) => ({ ...a, n })));
  while (added.length) {
    const top = commonest(added);
    const sendsWithIt = new Set(top.map((t) => t.n)).size;
    if (sendsWithIt < need) break;
    drift.added.push({ text: top[0].text, after: top[0].after >= 0 ? base[top[0].after] : null, count: sendsWithIt });
    for (const t of top) added.splice(added.indexOf(t), 1);
  }

  if (!drift.removed.length && !drift.changed.length && !drift.added.length) return null;
  const key = [
    ...drift.removed.map((r) => `-${r.text.toLowerCase()}`),
    ...drift.changed.map((c) => `~${c.from.toLowerCase()}>${[...exact(c.to)].sort().join(" ")}`),
    ...drift.added.map((a) => `+${[...exact(a.text)].sort().join(" ")}`),
  ].sort();
  drift.signature = createHash("sha1").update(key.join("\n")).digest("hex").slice(0, 16);
  return drift;
}

// The macro with the team's edits applied, without the AI: deleted
// sentences dropped, reworded ones swapped for the latest wording, added ones
// placed after the sentence they followed. Used until the AI has rewritten it.
export function applyDrift(macroBody: string, drift: Drift): string {
  const lines = macroBody.replace(/\r\n?/g, "\n").split("\n");
  const removed = new Set(drift.removed.map((r) => r.text));
  const changed = new Map(drift.changed.map((c) => [c.from, c.to]));
  const out: string[] = [];
  const addAfter = (anchor: string | null) => drift.added.filter((a) => a.after === anchor).map((a) => a.text);
  // Additions with no anchor go after the greeting, or first.
  const top = addAfter(null);
  let placedTop = !top.length;
  for (const line of lines) {
    const parts = sentences(line);
    if (!parts.length) {
      out.push(line);
      continue;
    }
    const kept: string[] = [];
    for (const s of parts) {
      if (!removed.has(s)) kept.push(changed.get(s) ?? s);
      kept.push(...addAfter(s));
    }
    const isGreeting = /^(hi|hello|hey|dear)\b/i.test(line.trim());
    if (!placedTop && !isGreeting) {
      out.push(top.join(" "));
      placedTop = true;
    }
    if (kept.length) out.push(kept.join(" "));
    if (!placedTop && isGreeting) {
      out.push(top.join(" "));
      placedTop = true;
    }
  }
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type MacroUpdate = { macro: { id: string; name: string; body: string }; drift: Drift };

// Every macro the team keeps editing the same way, most-used first.
export async function macroUpdates(orgId: string): Promise<MacroUpdate[]> {
  const macros = await db.select({ id: schema.macros.id, name: schema.macros.name, body: schema.macros.body }).from(schema.macros).where(eq(schema.macros.orgId, orgId));
  if (!macros.length) return [];
  const [uses, dismissed] = await Promise.all([
    db
      .select({ macroId: schema.macroUses.macroId, macroBody: schema.macroUses.macroBody, body: schema.messages.body })
      .from(schema.macroUses)
      .innerJoin(schema.messages, eq(schema.messages.id, schema.macroUses.messageId))
      .where(and(eq(schema.macroUses.orgId, orgId), inArray(schema.macroUses.macroId, macros.map((m) => m.id))))
      .orderBy(desc(schema.macroUses.createdAt))
      .limit(2000),
    db.select().from(schema.macroUpdateDismissals).where(eq(schema.macroUpdateDismissals.orgId, orgId)),
  ]);
  const skip = new Set(dismissed.map((d) => `${d.macroId}:${d.signature}`));
  const out: MacroUpdate[] = [];
  for (const m of macros) {
    const sends = uses.filter((u) => u.macroId === m.id && u.macroBody === m.body).slice(0, DRIFT.recent).map((u) => u.body);
    const drift = macroDrift(m.body, sends);
    if (drift && !skip.has(`${m.id}:${drift.signature}`)) out.push({ macro: m, drift });
  }
  return out.sort((a, b) => b.drift.uses - a.drift.uses);
}

// Records which macros a reply started from, with their text at that moment.
export async function recordMacroUses(orgId: string, messageId: string, macroIds: string[]) {
  const ids = [...new Set(macroIds)].filter(isUuid).slice(0, 5);
  if (!ids.length) return;
  const macros = await db.select({ id: schema.macros.id, body: schema.macros.body }).from(schema.macros).where(and(eq(schema.macros.orgId, orgId), inArray(schema.macros.id, ids)));
  if (macros.length) await db.insert(schema.macroUses).values(macros.map((m) => ({ orgId, macroId: m.id, messageId, macroBody: m.body })));
}
