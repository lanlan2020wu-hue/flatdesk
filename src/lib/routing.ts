import { and, asc, count, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { TriggerAction, TriggerCondition } from "@/db/schema";
import { isUuid } from "@/lib/ids";
import { checkTrigger, MAX_TRIGGERS } from "@/lib/triggers";

// Groups, sharing tickets in turn, and closing quiet pending tickets.
//
// Sharing in turn happens once a ticket needs a person: after the AI has had
// its turn on a new ticket, or when a ticket the AI answered comes back to the
// team. Tickets the AI answers never land in anyone's queue.

const { groups, groupMembers, tickets, agents, orgs, messages } = schema;
export type Group = typeof groups.$inferSelect;

export const MAX_GROUPS = 50;
export const AUTO_CLOSE_CHOICES = [3, 5, 7, 14, 30] as const;

export async function listGroups(orgId: string) {
  const [rows, members] = await Promise.all([
    db.select().from(groups).where(eq(groups.orgId, orgId)).orderBy(asc(groups.name)),
    db.select({ groupId: groupMembers.groupId, userId: groupMembers.userId }).from(groupMembers).where(eq(groupMembers.orgId, orgId)),
  ]);
  return rows.map((g) => ({ ...g, members: members.filter((m) => m.groupId === g.id).map((m) => m.userId) }));
}

export async function findGroup(orgId: string, id: string | null | undefined) {
  if (!id || !isUuid(id)) return undefined;
  return db.query.groups.findFirst({ where: and(eq(groups.orgId, orgId), eq(groups.id, id)) });
}

// Ids of the groups someone is in, for the "My groups" view.
export async function myGroupIds(orgId: string, userId: string): Promise<string[]> {
  const rows = await db.select({ id: groupMembers.groupId }).from(groupMembers).where(and(eq(groupMembers.orgId, orgId), eq(groupMembers.userId, userId)));
  return rows.map((r) => r.id);
}

export async function saveGroup(
  orgId: string,
  input: { id?: string; name: string; shareInTurn: boolean; members: string[] },
): Promise<{ id: string } | { error: string }> {
  const name = input.name.trim().slice(0, 60);
  if (!name) return { error: "Give the group a name." };
  const team = await db
    .select({ userId: agents.userId })
    .from(agents)
    .where(and(eq(agents.orgId, orgId), eq(agents.viewer, false), isNull(agents.removedAt), inArray(agents.userId, input.members.length ? input.members : [""])));
  const members = team.map((t) => t.userId);
  return db.transaction(async (tx) => {
    let id = input.id;
    const clash = await tx.query.groups.findFirst({ where: and(eq(groups.orgId, orgId), sql`lower(${groups.name}) = lower(${name})`) });
    if (clash && clash.id !== id) return { error: `There's already a group called ${clash.name}.` };
    if (id) {
      const [row] = await tx.update(groups).set({ name, shareInTurn: input.shareInTurn }).where(and(eq(groups.orgId, orgId), eq(groups.id, id))).returning({ id: groups.id });
      if (!row) return { error: "That group was deleted." };
      await tx.delete(groupMembers).where(eq(groupMembers.groupId, id));
    } else {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)` }).from(groups).where(eq(groups.orgId, orgId));
      if (Number(n) >= MAX_GROUPS) return { error: `A team can have up to ${MAX_GROUPS} groups.` };
      [{ id }] = await tx.insert(groups).values({ orgId, name, shareInTurn: input.shareInTurn }).returning({ id: groups.id });
    }
    if (members.length) await tx.insert(groupMembers).values(members.map((userId) => ({ groupId: id!, orgId, userId })));
    return { id: id! };
  });
}

// Its tickets stay, without a group.
export async function deleteGroup(orgId: string, id: string) {
  return db.transaction(async (tx) => {
    const [gone] = await tx.delete(groups).where(and(eq(groups.orgId, orgId), eq(groups.id, id))).returning({ name: groups.name });
    if (gone) await tx.update(tickets).set({ groupId: null }).where(and(eq(tickets.orgId, orgId), eq(tickets.groupId, id)));
    return gone ?? null;
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Who gets the next ticket: someone who can take tickets, isn't away, and
// (for a group) is in it, picked by who was given one in turn longest ago.
async function nextInTurn(tx: Tx, orgId: string, groupId: string | null) {
  const where = [eq(agents.orgId, orgId), eq(agents.viewer, false), isNull(agents.removedAt), eq(agents.away, false)];
  if (groupId) where.push(sql`exists (select 1 from ${groupMembers} where ${groupMembers.groupId} = ${groupId} and ${groupMembers.userId} = ${agents.userId})`);
  const [next] = await tx
    .select({ userId: agents.userId, name: agents.name })
    .from(agents)
    .where(and(...where))
    .orderBy(sql`${agents.lastTurnAt} asc nulls first`, asc(agents.name), asc(agents.userId))
    .limit(1);
  return next ?? null;
}

// Gives an open, unassigned ticket to the next person in turn, if its group
// (or, with no group, the team) shares tickets that way. Returns who got it.
// Safe to call more than once: an assigned ticket is left alone.
export async function shareTicket(orgId: string, ticketId: string): Promise<string | null> {
  return db.transaction(async (tx) => {
    // One at a time per team, so two tickets arriving together go to two people.
    const [org] = await tx.select({ shareInTurn: orgs.shareInTurn }).from(orgs).where(eq(orgs.id, orgId)).for("update");
    if (!org) return null;
    const [t] = await tx
      .select({ id: tickets.id, groupId: tickets.groupId })
      .from(tickets)
      .where(and(eq(tickets.orgId, orgId), eq(tickets.id, ticketId), eq(tickets.status, "open"), isNull(tickets.assigneeId), isNull(tickets.mergedIntoId)));
    if (!t) return null;
    const group = t.groupId ? await tx.query.groups.findFirst({ where: and(eq(groups.orgId, orgId), eq(groups.id, t.groupId)) }) : undefined;
    if (group ? !group.shareInTurn : !org.shareInTurn) return null;
    const next = await nextInTurn(tx, orgId, group?.id ?? null);
    if (!next) return null;
    const now = new Date();
    await tx.update(tickets).set({ assigneeId: next.userId }).where(eq(tickets.id, t.id));
    await tx.update(agents).set({ lastTurnAt: now }).where(and(eq(agents.orgId, orgId), eq(agents.userId, next.userId)));
    await tx.insert(messages).values({
      orgId,
      ticketId: t.id,
      authorType: "system",
      internal: true,
      body: `Given to ${next.name} in turn${group ? ` (${group.name} group)` : ""}.`,
      createdAt: now,
    });
    return next.userId;
  });
}

// Never throws: routing is a convenience and mustn't stop alerts or replies.
export async function shareTicketQuietly(orgId: string, ticketId: string) {
  try {
    return await shareTicket(orgId, ticketId);
  } catch (err) {
    console.error("sharing in turn failed", orgId, ticketId, err);
    return null;
  }
}

export async function setAway(orgId: string, userId: string, away: boolean) {
  await db.update(agents).set({ away }).where(and(eq(agents.orgId, orgId), eq(agents.userId, userId)));
}

// Closing quiet pending tickets is a timed trigger (lib/triggers.ts). This
// adds one in a click: pending, no update for `days` days, close with a note.
export async function addAutoCloseTrigger(orgId: string, days: number): Promise<{ ok: true } | { error: string }> {
  if (!(AUTO_CLOSE_CHOICES as readonly number[]).includes(days)) return { error: "Pick how many days." };
  const conditions: TriggerCondition[] = [{ field: "status", op: "is", value: "pending" }];
  const actions: TriggerAction[] = [
    { type: "set_status", status: "closed" },
    { type: "note", body: `Closed on its own: no reply from the customer in ${days} days. If they write back, it opens again.` },
  ];
  const name = `Close pending tickets after ${days} days`;
  const error = checkTrigger(name, conditions, actions, "timed", days * 24);
  if (error) return { error };
  const [{ n, last }] = await db.select({ n: count(), last: max(schema.triggers.position) }).from(schema.triggers).where(eq(schema.triggers.orgId, orgId));
  if (Number(n) >= MAX_TRIGGERS) return { error: `A team can have up to ${MAX_TRIGGERS} triggers.` };
  await db.insert(schema.triggers).values({ orgId, name, event: "timed", hours: days * 24, matchAll: true, conditions, actions, position: (last ?? -1) + 1 });
  return { ok: true };
}

// The team's timed triggers that close pending tickets, for the routing page.
export async function autoCloseTriggers(orgId: string) {
  const rows = await db
    .select({ id: schema.triggers.id, name: schema.triggers.name, hours: schema.triggers.hours, enabled: schema.triggers.enabled, actions: schema.triggers.actions })
    .from(schema.triggers)
    .where(and(eq(schema.triggers.orgId, orgId), eq(schema.triggers.event, "timed")));
  return rows.filter((t) => t.actions.some((a) => a.type === "set_status" && a.status === "closed"));
}
