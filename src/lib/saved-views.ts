// Saved inbox views: a filter someone uses every day ("Urgent billing,
// unassigned", "My chats", "Plan is Business") saved as a tab in the inbox.
// A view is the person's own, or shared with the whole team. Anyone can make
// their own; shared views are made and changed by admins.

import { and, asc, count, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ViewFilters } from "@/db/schema";
import { awake } from "@/lib/snooze";
import { inMyGroups, isPriority, normalizeTags, selectTickets } from "@/lib/tickets";
import { notTrashed } from "@/lib/trash";

export const VIEW_LIMITS = { perPerson: 10, shared: 10, nameChars: 40 };

export class ViewError extends Error {}

const { savedViews, tickets } = schema;

export type SavedView = typeof savedViews.$inferSelect;

const STATUSES = ["active", "open", "pending", "closed"] as const;

// The filters from the inbox's "New view" form. Empty choices mean "any".
export function parseViewForm(get: (key: string) => string, getAll: (key: string) => string[]): { name: string; filters: ViewFilters; shared: boolean } {
  const name = get("name").replace(/\s+/g, " ").trim();
  if (!name) throw new ViewError("Give the view a name.");
  if (name.length > VIEW_LIMITS.nameChars) throw new ViewError(`A view name can be up to ${VIEW_LIMITS.nameChars} characters.`);
  const filters: ViewFilters = {};
  const status = get("status");
  if ((STATUSES as readonly string[]).includes(status)) filters.status = status as ViewFilters["status"];
  const assignee = get("assignee").trim();
  if (assignee) filters.assignee = assignee.slice(0, 100);
  const group = get("groupId").trim();
  if (group) filters.groupId = group.slice(0, 100);
  const priorities = [...new Set(getAll("priority").filter(isPriority))];
  if (priorities.length && priorities.length < 4) filters.priorities = priorities;
  const tags = normalizeTags(get("tags").split(","));
  if (tags.length) filters.tags = tags.slice(0, 10);
  const channel = get("channel");
  if (channel === "email" || channel === "chat") filters.channel = channel;
  const fieldName = get("fieldName").trim();
  const fieldValue = get("fieldValue").trim();
  if (fieldName && fieldValue) filters.field = { name: fieldName.slice(0, 40), value: fieldValue.slice(0, 200) };
  if (!Object.keys(filters).length) throw new ViewError("Pick at least one filter, like a status, an assignee or a tag.");
  return { name, filters, shared: get("shared") === "on" };
}

// The view's filters as SQL, for the person looking at it.
export function viewWhere(orgId: string, userId: string, f: ViewFilters): SQL[] {
  const where: SQL[] = [eq(tickets.orgId, orgId), notTrashed];
  const status = f.status ?? "active";
  if (status === "active") where.push(inArray(tickets.status, ["open", "pending"]));
  else where.push(eq(tickets.status, status));
  if (status !== "closed") where.push(awake);
  if (f.assignee === "me") where.push(eq(tickets.assigneeId, userId));
  else if (f.assignee === "unassigned") where.push(isNull(tickets.assigneeId));
  else if (f.assignee) where.push(eq(tickets.assigneeId, f.assignee));
  if (f.groupId === "mine") where.push(inMyGroups(orgId, userId));
  else if (f.groupId) where.push(sql`${tickets.groupId}::text = ${f.groupId}`);
  if (f.priorities?.length) where.push(inArray(tickets.priority, f.priorities));
  if (f.tags?.length) where.push(sql`${tickets.tags} && array[${sql.join(f.tags.map((t) => sql`${t}`), sql`, `)}]::text[]`);
  if (f.channel) where.push(eq(tickets.channel, f.channel));
  if (f.field) where.push(sql`lower(${tickets.fields} ->> ${f.field.name}) = lower(${f.field.value})`);
  return where;
}

// One line under the tabs saying what the view holds.
export function describeView(f: ViewFilters, names: { agent: (id: string) => string; group: (id: string) => string }) {
  const parts: string[] = [];
  const status = f.status ?? "active";
  parts.push(status === "active" ? "Open and pending" : status === "open" ? "Open" : status === "pending" ? "Pending" : "Closed");
  if (f.priorities?.length) parts.push(`${f.priorities.join(" or ")} priority`);
  if (f.channel) parts.push(f.channel === "chat" ? "chats" : "emails");
  if (f.assignee === "me") parts.push("assigned to you");
  else if (f.assignee === "unassigned") parts.push("unassigned");
  else if (f.assignee) parts.push(`assigned to ${names.agent(f.assignee)}`);
  if (f.groupId === "mine") parts.push("in your groups");
  else if (f.groupId) parts.push(`in ${names.group(f.groupId)}`);
  if (f.tags?.length) parts.push(`tagged ${f.tags.join(" or ")}`);
  if (f.field) parts.push(`where ${f.field.name} is ${f.field.value}`);
  return `${parts.join(", ")}.`;
}

// The views a person sees: their own, then the team's.
export async function viewsFor(orgId: string, userId: string) {
  return db
    .select()
    .from(savedViews)
    .where(and(eq(savedViews.orgId, orgId), or(eq(savedViews.ownerId, userId), isNull(savedViews.ownerId))))
    .orderBy(sql`${savedViews.ownerId} is null`, asc(savedViews.createdAt));
}

export async function findView(orgId: string, userId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [v] = await db
    .select()
    .from(savedViews)
    .where(and(eq(savedViews.orgId, orgId), eq(savedViews.id, id), or(eq(savedViews.ownerId, userId), isNull(savedViews.ownerId))));
  return v ?? null;
}

export function viewTickets(orgId: string, userId: string, f: ViewFilters) {
  return selectTickets(viewWhere(orgId, userId, f));
}

export async function viewCount(orgId: string, userId: string, f: ViewFilters) {
  const [{ n }] = await db.select({ n: count() }).from(tickets).where(and(...viewWhere(orgId, userId, f)));
  return Number(n);
}

export async function createView(orgId: string, userId: string, isAdmin: boolean, input: ReturnType<typeof parseViewForm>) {
  if (input.shared && !isAdmin) throw new ViewError("Only admins can share a view with the team.");
  const ownerId = input.shared ? null : userId;
  const [{ n }] = await db
    .select({ n: count() })
    .from(savedViews)
    .where(and(eq(savedViews.orgId, orgId), ownerId ? eq(savedViews.ownerId, ownerId) : isNull(savedViews.ownerId)));
  const max = ownerId ? VIEW_LIMITS.perPerson : VIEW_LIMITS.shared;
  if (Number(n) >= max) throw new ViewError(`You can have up to ${max} ${ownerId ? "views of your own" : "shared views"}. Delete one first.`);
  const [row] = await db.insert(savedViews).values({ orgId, ownerId, createdBy: userId, name: input.name, filters: input.filters }).returning();
  return row;
}

// The owner deletes their own view; an admin deletes a shared one.
export async function deleteView(orgId: string, userId: string, isAdmin: boolean, id: string) {
  const v = await findView(orgId, userId, id);
  if (!v) return null;
  if (v.ownerId === null && !isAdmin) throw new ViewError("Only admins can delete a shared view.");
  await db.delete(savedViews).where(eq(savedViews.id, v.id));
  return v;
}
