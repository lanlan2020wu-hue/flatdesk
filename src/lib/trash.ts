import { and, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";

const { tickets, messages, orgs } = schema;

// Deleted tickets wait in the trash this long, then are deleted for good.
export const TRASH_DAYS = 30;
export const MAX_BLOCKED = 500;

// Ticket lists, search, reports and exports leave out trashed tickets.
export const notTrashed = isNull(tickets.deletedAt);

// A blocklist entry is a whole address (spam@example.com) or everyone at a
// domain (@example.com; "example.com" is read the same way). Lowercase.
// Returns null for anything that is neither.
export function normalizeBlockEntry(raw: string): string | null {
  const v = raw.trim().toLowerCase().replace(/^mailto:/, "");
  const DOMAIN = /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
  if (v.startsWith("@")) return DOMAIN.test(v.slice(1)) ? v : null;
  const at = v.lastIndexOf("@");
  if (at === -1) return DOMAIN.test(v) ? `@${v}` : null;
  const local = v.slice(0, at);
  if (!local || local.length > 64 || /[\s<>"(),;:]/.test(local) || !DOMAIN.test(v.slice(at + 1))) return null;
  return v;
}

// One entry per line or comma. Returns the cleaned list and what couldn't be read.
export function parseBlockList(text: string): { list: string[]; rejected: string[] } {
  const list: string[] = [];
  const rejected: string[] = [];
  for (const part of text.split(/[\n,;]+/)) {
    if (!part.trim()) continue;
    const entry = normalizeBlockEntry(part);
    if (!entry) rejected.push(part.trim().slice(0, 80));
    else if (!list.includes(entry)) list.push(entry);
  }
  return { list: list.slice(0, MAX_BLOCKED), rejected };
}

// Whether mail from this address is blocked. A domain entry also covers its
// subdomains (@example.com blocks mail.example.com).
export function isBlocked(list: readonly string[], email: string): boolean {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at === -1) return false;
  if (list.includes(e)) return true;
  const domain = e.slice(at + 1);
  return list.some((entry) => entry.startsWith("@") && (domain === entry.slice(1) || domain.endsWith(`.${entry.slice(1)}`)));
}

// Moves tickets to the trash. Each is closed so automations, targets and the
// AI leave it alone; restoring puts its status back. Returns how many moved.
export async function trashTickets(orgId: string, ids: string[], by: string, reason?: string): Promise<number> {
  if (!ids.length) return 0;
  const now = new Date();
  return db.transaction(async (tx) => {
    const moved = await tx
      .update(tickets)
      .set({ deletedAt: now, deletedStatus: sql`${tickets.status}`, status: "closed", updatedAt: now })
      .where(and(eq(tickets.orgId, orgId), inArray(tickets.id, ids), notTrashed))
      .returning({ id: tickets.id });
    if (moved.length) {
      const body = reason ?? `Moved to the trash by ${by}. It is deleted for good after ${TRASH_DAYS} days unless someone restores it.`;
      await tx.insert(messages).values(moved.map((t) => ({ orgId, ticketId: t.id, authorType: "system" as const, internal: true, body, createdAt: now })));
    }
    return moved.length;
  });
}

// Takes tickets out of the trash, with the status they had.
export async function restoreTickets(orgId: string, ids: string[], by: string): Promise<number> {
  if (!ids.length) return 0;
  const now = new Date();
  return db.transaction(async (tx) => {
    const back = await tx
      .update(tickets)
      .set({ status: sql`coalesce(${tickets.deletedStatus}, 'open'::ticket_status)`, deletedAt: null, deletedStatus: null, updatedAt: now })
      .where(and(eq(tickets.orgId, orgId), inArray(tickets.id, ids), isNotNull(tickets.deletedAt)))
      .returning({ id: tickets.id });
    if (back.length) {
      await tx.insert(messages).values(back.map((t) => ({ orgId, ticketId: t.id, authorType: "system" as const, internal: true, body: `Restored from the trash by ${by}.`, createdAt: now })));
    }
    return back.length;
  });
}

// Adds an address or domain to the team's blocklist. Returns the entry, or
// null when it isn't one.
export async function blockSender(orgId: string, raw: string): Promise<string | null> {
  const entry = normalizeBlockEntry(raw);
  if (!entry) return null;
  await db
    .update(orgs)
    .set({ blockedSenders: sql`(case when ${entry} = any(${orgs.blockedSenders}) then ${orgs.blockedSenders} else array_append(${orgs.blockedSenders}, ${entry}::text) end)` })
    .where(and(eq(orgs.id, orgId), sql`cardinality(${orgs.blockedSenders}) < ${MAX_BLOCKED}`));
  return entry;
}

// Daily: deletes tickets that have been in the trash longer than TRASH_DAYS.
// Their messages and files go with them (foreign keys cascade).
// orgId limits it to one team (tests).
export async function purgeTrash(now = new Date(), orgId?: string): Promise<number> {
  const cutoff = new Date(now.getTime() - TRASH_DAYS * 86_400_000);
  const gone = await db
    .delete(tickets)
    .where(and(isNotNull(tickets.deletedAt), lt(tickets.deletedAt, cutoff), orgId ? eq(tickets.orgId, orgId) : undefined))
    .returning({ id: tickets.id });
  return gone.length;
}
