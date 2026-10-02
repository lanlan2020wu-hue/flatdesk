import { clerkClient } from "@clerk/nextjs/server";
import { and, eq, inArray, isNotNull, isNull, notInArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { clerkEnabled } from "@/lib/auth-config";
import { syncSeats } from "@/lib/billing";

const { agents, orgs } = schema;

// Someone who can be given tickets: on the team, not a viewer, not removed.
export const assignable = (orgId: string, userId: string) =>
  and(eq(agents.orgId, orgId), eq(agents.userId, userId), eq(agents.viewer, false), isNull(agents.removedAt));

export async function findAssignable(orgId: string, userId: string) {
  if (!userId) return undefined;
  return db.query.agents.findFirst({ where: assignable(orgId, userId) });
}

// Matches the team's rows to who is in the Clerk org now. People who left are
// marked removed (their name stays on old tickets); people who came back are
// restored. An empty member list is never trusted, since every org has someone.
export async function markMembers(orgId: string, memberIds: string[], now = new Date()) {
  if (memberIds.length === 0) return { removed: 0, restored: 0 };
  const removed = await db
    .update(agents)
    .set({ removedAt: now })
    .where(and(eq(agents.orgId, orgId), isNull(agents.removedAt), notInArray(agents.userId, memberIds)))
    .returning({ userId: agents.userId });
  const restored = await db
    .update(agents)
    .set({ removedAt: null })
    .where(and(eq(agents.orgId, orgId), isNotNull(agents.removedAt), inArray(agents.userId, memberIds)))
    .returning({ userId: agents.userId });
  return { removed: removed.length, restored: restored.length };
}

// Daily: pick up members removed in Clerk and teams renamed in Clerk. There is
// no Clerk webhook, so this is the only place a removal is seen for someone
// who never signs in again.
export async function reconcileTeams({ budgetMs = 60_000 } = {}) {
  if (!clerkEnabled) return {};
  const started = Date.now();
  const clerk = await clerkClient();
  const rows = await db.select({ id: orgs.id, name: orgs.name }).from(orgs);
  const results: Record<string, string> = {};
  for (const org of rows) {
    if (Date.now() - started > budgetMs) {
      results[org.id] = "skipped (time limit)";
      continue;
    }
    try {
      const team = await clerk.organizations.getOrganization({ organizationId: org.id });
      if (team.name && team.name !== org.name) await db.update(orgs).set({ name: team.name }).where(eq(orgs.id, org.id));
      const ids: string[] = [];
      for (let offset = 0; ; offset += 100) {
        const page = await clerk.organizations.getOrganizationMembershipList({ organizationId: org.id, limit: 100, offset });
        for (const m of page.data) if (m.publicUserData?.userId) ids.push(m.publicUserData.userId);
        if (page.data.length < 100 || offset + 100 >= page.totalCount) break;
      }
      const { removed, restored } = await markMembers(org.id, ids);
      if (removed || restored) await syncSeats(org.id).catch((err) => console.error("seat sync failed", org.id, err));
      results[org.id] = removed || restored ? `removed ${removed}, restored ${restored}` : "ok";
    } catch (err) {
      console.error("team reconcile failed", org.id, err);
      results[org.id] = "error";
    }
  }
  return results;
}
