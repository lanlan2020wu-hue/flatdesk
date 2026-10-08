import { and, asc, eq, gt, isNull, lte, not, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { TriggerAction, TriggerCondition, TriggerEvent } from "@/db/schema";
import { maskCards } from "@/lib/redact";

export type { TriggerAction, TriggerCondition, TriggerEvent };

// Triggers: "when a ticket matches these conditions, do these things", like
// Zendesk's triggers and automations. Each runs at one moment: on a new
// ticket, when the customer writes back, or once a ticket has gone a number
// of hours without an update (checked every few minutes from /api/cron/sla).
// They run in order, so tags one trigger adds can match a later one. On new
// tickets the tag rules ("if tagged X, assign to Y") run after them, for
// tickets still unassigned.

type Status = "open" | "pending" | "closed";
export type TriggerTicket = { channel: "email" | "chat"; subject: string; body: string; from: string; tags: string[]; status?: Status };
export type TriggerResult = { tags: string[]; assignTo: string | null; groupId: string | null; status: Status | null; notes: string[]; replies: string[]; fired: string[] };
type Trigger = Pick<typeof schema.triggers.$inferSelect, "name" | "enabled" | "matchAll" | "conditions" | "actions">;

export const EVENTS: { id: TriggerEvent; label: string }[] = [
  { id: "created", label: "a new ticket arrives" },
  { id: "updated", label: "the customer writes back" },
  { id: "timed", label: "a ticket has had no update for" },
];
export const MAX_HOURS = 30 * 24;

export const CONDITION_FIELDS = [
  { id: "subject_or_body", label: "Subject or message" },
  { id: "subject", label: "Subject" },
  { id: "body", label: "Message" },
  { id: "from", label: "Sender's email" },
  { id: "tags", label: "Tags" },
  { id: "channel", label: "Channel" },
  { id: "status", label: "Status" },
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
  if (c.field === "status") return c.op === "is" ? t.status === c.value : t.status !== c.value;
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
// now (not a viewer or removed); an assignment to anyone else is skipped, and
// so is a group that was deleted.
export function runTriggers(list: Trigger[], ticket: TriggerTicket, canAssign: (userId: string) => boolean, isGroup: (id: string) => boolean = () => false): TriggerResult {
  const t = { ...ticket, tags: [...ticket.tags] };
  const out: TriggerResult = { tags: t.tags, assignTo: null, groupId: null, status: null, notes: [], replies: [], fired: [] };
  for (const trigger of list) {
    if (!triggerMatches(trigger, t)) continue;
    out.fired.push(trigger.name);
    for (const a of trigger.actions) {
      if (a.type === "add_tags") {
        for (const tag of a.tags) if (!t.tags.includes(tag)) t.tags.push(tag);
      } else if (a.type === "assign" && canAssign(a.to)) out.assignTo = a.to;
      else if (a.type === "group" && isGroup(a.groupId)) out.groupId = a.groupId;
      else if (a.type === "set_status") out.status = t.status = a.status;
      else if (a.type === "note" && a.body.trim()) out.notes.push(a.body.trim());
      else if (a.type === "reply" && a.body.trim()) out.replies.push(a.body.trim());
    }
  }
  return out;
}

// In words, for the list on the rules page and imported-rule summaries.
export function describeCondition(c: TriggerCondition): string {
  const label = CONDITION_FIELDS.find((f) => f.id === c.field)?.label ?? c.field;
  if (c.field === "channel" || c.field === "status") return `${label} ${c.op === "is" ? "is" : "is not"} ${c.value}`;
  const list = terms(c.value).map((w) => `"${w}"`).join(" or ");
  return `${label} ${c.op === "includes" ? "has" : "doesn't have"} ${list}`;
}

export function describeAction(a: TriggerAction, agentName: (id: string) => string, groupName: (id: string) => string = () => "a group"): string {
  if (a.type === "assign") return `assign to ${agentName(a.to)}`;
  if (a.type === "group") return `send to ${groupName(a.groupId)}`;
  if (a.type === "add_tags") return `tag ${a.tags.join(", ")}`;
  if (a.type === "set_status") return `set ${a.status}`;
  const short = a.body.length > 60 ? `${a.body.slice(0, 60)}…` : a.body;
  return a.type === "reply" ? `email the customer: "${short}"` : `add a note: "${short}"`;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// The team's triggers for one moment, in order, with who can take tickets.
export async function loadTriggers(tx: Tx | typeof db, orgId: string, event: TriggerEvent = "created") {
  const [list, team, groups] = await Promise.all([
    tx.select().from(schema.triggers).where(and(eq(schema.triggers.orgId, orgId), eq(schema.triggers.enabled, true), eq(schema.triggers.event, event))).orderBy(asc(schema.triggers.position), asc(schema.triggers.createdAt)),
    tx
      .select({ userId: schema.agents.userId })
      .from(schema.agents)
      .where(and(eq(schema.agents.orgId, orgId), eq(schema.agents.viewer, false), isNull(schema.agents.removedAt))),
    tx.select({ id: schema.groups.id }).from(schema.groups).where(eq(schema.groups.orgId, orgId)),
  ]);
  const assignable = new Set(team.map((a) => a.userId));
  const groupIds = new Set(groups.map((g) => g.id));
  return { list, canAssign: (id: string) => assignable.has(id), isGroup: (id: string) => groupIds.has(id) };
}

// Checks a trigger built from a form or an import. Returns an error in words, or null.
export function checkTrigger(name: string, conditions: TriggerCondition[], actions: TriggerAction[], event: TriggerEvent = "created", hours: number | null = null): string | null {
  if (!name.trim()) return "Give the trigger a name.";
  if (!conditions.length) return "Add at least one condition.";
  if (conditions.length > MAX_CONDITIONS) return `A trigger can have up to ${MAX_CONDITIONS} conditions.`;
  if (!actions.length) return "Add at least one thing for it to do.";
  if (event === "timed" && !(hours && Number.isInteger(hours) && hours >= 1 && hours <= MAX_HOURS)) return `For a timed trigger, pick between 1 and ${MAX_HOURS} hours.`;
  // A new ticket gets the AI's answer or a person's; an automatic email on top would be a second reply.
  if (event !== "timed" && actions.some((a) => a.type === "reply")) return "Only timed triggers can email the customer.";
  return null;
}

export const FORM_ROWS = MAX_CONDITIONS;
const STATUSES = ["open", "pending", "closed"] as const;

// Reads the trigger form on the rules page. `get` returns a trimmed field value.
export function triggerFromForm(get: (key: string) => string, normalize: (tags: string[]) => string[]):
  | { error: string }
  | { name: string; matchAll: boolean; event: TriggerEvent; hours: number | null; conditions: TriggerCondition[]; actions: TriggerAction[] } {
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
    } else if (field === "status") {
      const v = value.toLowerCase();
      if (!(STATUSES as readonly string[]).includes(v)) return { error: "For Status, type open, pending or closed." };
      conditions.push({ field, op: op === "includes" ? "is" : "is_not", value: v as Status });
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
  if (get("groupId")) actions.push({ type: "group", groupId: get("groupId") });
  const status = get("setStatus");
  if ((STATUSES as readonly string[]).includes(status)) actions.push({ type: "set_status", status: status as (typeof STATUSES)[number] });
  const note = get("note").slice(0, 2000);
  if (note) actions.push({ type: "note", body: note });
  const reply = get("reply").slice(0, 5000);
  if (reply) actions.push({ type: "reply", body: reply });
  const event = (EVENTS.find((e) => e.id === get("event"))?.id ?? "created") as TriggerEvent;
  const hours = event === "timed" ? Number(get("hours")) : null;
  const name = get("name").slice(0, 120);
  const error = checkTrigger(name, conditions, actions, event, hours);
  if (error) return { error };
  return { name, matchAll: get("match") !== "any", event, hours, conditions, actions };
}

type TicketRow = typeof schema.tickets.$inferSelect;
type TicketSet = Partial<typeof schema.tickets.$inferInsert>;

// What a trigger sees of a ticket that already exists.
export function ticketForTriggers(t: TicketRow, from: string, body: string): TriggerTicket {
  return { channel: t.channel, subject: t.subject, body, from: from.toLowerCase(), tags: t.tags, status: t.status };
}

// Applies what fired to a ticket that already exists, inside the caller's
// transaction, along with `base` (the change that set it off). Automatic
// emails are added as messages from the team; returns their ids so the caller
// can send them once the transaction commits.
export async function applyToTicket(tx: Tx, ticket: TicketRow, ran: TriggerResult, now: Date, base: TicketSet = {}): Promise<string[]> {
  const set: TicketSet = { ...base, updatedAt: now };
  if (ran.fired.length) {
    set.tags = [...new Set(ran.tags)].slice(0, 20);
    if (ran.assignTo) set.assigneeId = ran.assignTo;
    if (ran.groupId) set.groupId = ran.groupId;
    if (ran.status) {
      set.status = ran.status;
      set.closedAt = ran.status === "closed" ? (ticket.closedAt ?? now) : null;
    }
  }
  await tx.update(schema.tickets).set(set).where(eq(schema.tickets.id, ticket.id));
  if (!ran.fired.length) return [];
  const ids: string[] = [];
  for (const body of ran.replies) {
    const [m] = await tx
      .insert(schema.messages)
      .values({ orgId: ticket.orgId, ticketId: ticket.id, authorType: "system", authorName: "Sent automatically", internal: false, body: maskCards(body), createdAt: now })
      .returning({ id: schema.messages.id });
    ids.push(m.id);
  }
  const note = `${TRIGGER_NOTE_PREFIX} ${ran.fired.join(", ")}.${ran.notes.length ? `\n\n${ran.notes.join("\n\n")}` : ""}`;
  await tx.insert(schema.messages).values({ orgId: ticket.orgId, ticketId: ticket.id, authorType: "system", internal: true, body: note, createdAt: new Date(now.getTime() + 1) });
  return ids;
}

const TIMED_BATCH = 500;
// Tickets idle longer than this past a trigger's hours are left alone, so a
// new timed trigger doesn't sweep through years of old tickets.
const TIMED_WINDOW_MS = 14 * 86_400_000;

// Timed triggers ("pending for 72 hours: email the customer, then close").
// Each runs once on a ticket until the customer or team writes again. A ticket
// it doesn't match is remembered until the ticket next changes. Returns the
// automatic emails to send.
export async function runTimedTriggers(now = new Date()): Promise<{ ran: number; emails: { orgId: string; messageId: string }[] }> {
  const { tickets, customers } = schema;
  const list = await db
    .select()
    .from(schema.triggers)
    .where(and(eq(schema.triggers.enabled, true), eq(schema.triggers.event, "timed")))
    .orderBy(asc(schema.triggers.orgId), asc(schema.triggers.position), asc(schema.triggers.createdAt));
  let ran = 0;
  const emails: { orgId: string; messageId: string }[] = [];
  for (const trigger of list) {
    if (!trigger.hours) continue;
    const cutoff = new Date(now.getTime() - trigger.hours * 3_600_000);
    const due = await db
      .select({ id: tickets.id })
      .from(tickets)
      .where(
        and(
          eq(tickets.orgId, trigger.orgId),
          isNull(tickets.deletedAt),
          lte(tickets.updatedAt, cutoff),
          gt(tickets.updatedAt, new Date(cutoff.getTime() - TIMED_WINDOW_MS)),
          not(sql`${trigger.id}::uuid = any(${tickets.timedRan})`),
          or(isNull(tickets.timedSkippedAt), sql`${tickets.timedSkippedAt} <> ${tickets.updatedAt}`, not(sql`${trigger.id}::uuid = any(${tickets.timedSkipped})`)),
          // Closed tickets brought over from the old help desk aren't touched.
          not(and(sql`${tickets.source} is not null`, eq(tickets.status, "closed"))!),
        ),
      )
      .orderBy(asc(tickets.updatedAt))
      .limit(TIMED_BATCH);
    if (!due.length) continue;
    const { canAssign, isGroup } = await loadTriggers(db, trigger.orgId, "timed");
    for (const { id } of due) {
      try {
        const sent = await db.transaction(async (tx) => {
          const [t] = await tx.select().from(tickets).where(eq(tickets.id, id)).for("update");
          if (!t || t.updatedAt > cutoff || t.timedRan.includes(trigger.id)) return null;
          const [c] = await tx.select({ email: customers.email }).from(customers).where(eq(customers.id, t.customerId));
          const result = runTriggers([trigger], ticketForTriggers(t, c?.email ?? "", ""), canAssign, isGroup);
          if (!result.fired.length) {
            const skipped = t.timedSkippedAt?.getTime() === t.updatedAt.getTime() ? t.timedSkipped : [];
            await tx.update(tickets).set({ timedSkipped: [...skipped, trigger.id], timedSkippedAt: t.updatedAt }).where(eq(tickets.id, t.id));
            return null;
          }
          return applyToTicket(tx, t, result, now, { timedRan: [...t.timedRan, trigger.id], timedSkipped: [], timedSkippedAt: null });
        });
        if (sent) {
          ran++;
          for (const messageId of sent) emails.push({ orgId: trigger.orgId, messageId });
        }
      } catch (err) {
        console.error("timed trigger failed", trigger.id, id, err);
      }
    }
  }
  return { ran, emails };
}
