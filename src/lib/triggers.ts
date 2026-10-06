import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { TriggerAction, TriggerCondition } from "@/db/schema";

export type { TriggerAction, TriggerCondition };

// Triggers: "when a new ticket matches these conditions, do these things",
// like Zendesk's triggers on ticket creation. They run in order, so tags one
// trigger adds can match a later one. The tag rules ("if tagged X, assign to
// Y") run after them, for tickets still unassigned.

export type TriggerTicket = { channel: "email" | "chat"; subject: string; body: string; from: string; tags: string[] };
export type TriggerResult = { tags: string[]; assignTo: string | null; status: "open" | "pending" | "closed" | null; notes: string[]; fired: string[] };
type Trigger = Pick<typeof schema.triggers.$inferSelect, "name" | "enabled" | "matchAll" | "conditions" | "actions">;

export const CONDITION_FIELDS = [
  { id: "subject_or_body", label: "Subject or message" },
  { id: "subject", label: "Subject" },
  { id: "body", label: "Message" },
  { id: "from", label: "Sender's email" },
  { id: "tags", label: "Tags" },
  { id: "channel", label: "Channel" },
] as const;

export const MAX_CONDITIONS = 4;
export const MAX_TRIGGERS = 100;
// Starts the note a new ticket gets when triggers ran on it.
export const TRIGGER_NOTE_PREFIX = "Triggers ran:";

// "refund, money back" -> ["refund", "money back"]
export function terms(value: string): string[] {
  return value
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

export function conditionMatches(c: TriggerCondition, t: TriggerTicket): boolean {
  if (c.field === "channel") return c.op === "is" ? t.channel === c.value : t.channel !== c.value;
  const wanted = terms(c.value);
  if (!wanted.length) return true;
  let hit: boolean;
  if (c.field === "tags") {
    hit = wanted.some((w) => t.tags.includes(w));
  } else {
    const text = (c.field === "subject" ? t.subject : c.field === "body" ? t.body : c.field === "from" ? t.from : `${t.subject}\n${t.body}`).toLowerCase();
    hit = wanted.some((w) => text.includes(w));
  }
  return c.op === "includes" ? hit : !hit;
}

export function triggerMatches(trigger: Trigger, t: TriggerTicket): boolean {
  if (!trigger.enabled || !trigger.conditions.length) return false;
  return trigger.matchAll ? trigger.conditions.every((c) => conditionMatches(c, t)) : trigger.conditions.some((c) => conditionMatches(c, t));
}

// Runs every trigger over a new ticket. `canAssign` says who can take tickets
// now (not a viewer or removed); an assignment to anyone else is skipped.
export function runTriggers(list: Trigger[], ticket: TriggerTicket, canAssign: (userId: string) => boolean): TriggerResult {
  const t = { ...ticket, tags: [...ticket.tags] };
  const out: TriggerResult = { tags: t.tags, assignTo: null, status: null, notes: [], fired: [] };
  for (const trigger of list) {
    if (!triggerMatches(trigger, t)) continue;
    out.fired.push(trigger.name);
    for (const a of trigger.actions) {
      if (a.type === "add_tags") {
        for (const tag of a.tags) if (!t.tags.includes(tag)) t.tags.push(tag);
      } else if (a.type === "assign" && canAssign(a.to)) out.assignTo = a.to;
      else if (a.type === "set_status") out.status = a.status;
      else if (a.type === "note" && a.body.trim()) out.notes.push(a.body.trim());
    }
  }
  return out;
}

// In words, for the list on the rules page and imported-rule summaries.
export function describeCondition(c: TriggerCondition): string {
  const label = CONDITION_FIELDS.find((f) => f.id === c.field)?.label ?? c.field;
  if (c.field === "channel") return `${label} ${c.op === "is" ? "is" : "is not"} ${c.value}`;
  const list = terms(c.value).map((w) => `"${w}"`).join(" or ");
  return `${label} ${c.op === "includes" ? "has" : "doesn't have"} ${list}`;
}

export function describeAction(a: TriggerAction, agentName: (id: string) => string): string {
  if (a.type === "assign") return `assign to ${agentName(a.to)}`;
  if (a.type === "add_tags") return `tag ${a.tags.join(", ")}`;
  if (a.type === "set_status") return `set ${a.status}`;
  return `add a note: "${a.body.length > 60 ? `${a.body.slice(0, 60)}…` : a.body}"`;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// The team's triggers, in order, with who can take tickets, for createTicket.
export async function loadTriggers(tx: Tx | typeof db, orgId: string) {
  const [list, team] = await Promise.all([
    tx.select().from(schema.triggers).where(and(eq(schema.triggers.orgId, orgId), eq(schema.triggers.enabled, true))).orderBy(asc(schema.triggers.position), asc(schema.triggers.createdAt)),
    tx
      .select({ userId: schema.agents.userId })
      .from(schema.agents)
      .where(and(eq(schema.agents.orgId, orgId), eq(schema.agents.viewer, false), isNull(schema.agents.removedAt))),
  ]);
  const assignable = new Set(team.map((a) => a.userId));
  return { list, canAssign: (id: string) => assignable.has(id) };
}

// Checks a trigger built from a form or an import. Returns an error in words, or null.
export function checkTrigger(name: string, conditions: TriggerCondition[], actions: TriggerAction[]): string | null {
  if (!name.trim()) return "Give the trigger a name.";
  if (!conditions.length) return "Add at least one condition.";
  if (conditions.length > MAX_CONDITIONS) return `A trigger can have up to ${MAX_CONDITIONS} conditions.`;
  if (!actions.length) return "Add at least one thing for it to do.";
  return null;
}

export const FORM_ROWS = MAX_CONDITIONS;
const STATUSES = ["open", "pending", "closed"] as const;

// Reads the trigger form on the rules page. `get` returns a trimmed field value.
export function triggerFromForm(get: (key: string) => string, normalize: (tags: string[]) => string[]):
  | { error: string }
  | { name: string; matchAll: boolean; conditions: TriggerCondition[]; actions: TriggerAction[] } {
  const conditions: TriggerCondition[] = [];
  for (let i = 0; i < FORM_ROWS; i++) {
    const field = get(`c${i}_field`);
    const op = get(`c${i}_op`) === "excludes" ? "excludes" : "includes";
    const value = get(`c${i}_value`).slice(0, 500);
    if (!value) continue;
    if (field === "channel") {
      const v = value.toLowerCase();
      if (v !== "email" && v !== "chat") return { error: "For Channel, type email or chat." };
      conditions.push({ field, op: op === "includes" ? "is" : "is_not", value: v });
    } else if (field === "tags") {
      conditions.push({ field, op, value: normalize(value.split(",")).join(", ") });
    } else if (field === "subject" || field === "body" || field === "subject_or_body" || field === "from") {
      conditions.push({ field, op, value });
    }
  }
  const actions: TriggerAction[] = [];
  const tags = normalize(get("addTags").split(","));
  if (tags.length) actions.push({ type: "add_tags", tags });
  if (get("assignTo")) actions.push({ type: "assign", to: get("assignTo") });
  const status = get("setStatus");
  if ((STATUSES as readonly string[]).includes(status)) actions.push({ type: "set_status", status: status as (typeof STATUSES)[number] });
  const note = get("note").slice(0, 2000);
  if (note) actions.push({ type: "note", body: note });
  const name = get("name").slice(0, 120);
  const error = checkTrigger(name, conditions, actions);
  if (error) return { error };
  return { name, matchAll: get("match") !== "any", conditions, actions };
}
