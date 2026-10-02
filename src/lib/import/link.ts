import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";

const { externalAgents, importedRules } = schema;

// Makes the Flatdesk rule "tag -> agent" (or finds the one that already
// exists, since the pair is unique) and returns its id.
export async function claimRule(orgId: string, tag: string, userId: string, enabled: boolean): Promise<string> {
  await db.insert(schema.rules).values({ orgId, ifTag: tag, assignTo: userId, enabled }).onConflictDoNothing({
    target: [schema.rules.orgId, schema.rules.ifTag, schema.rules.assignTo],
  });
  const [rule] = await db
    .select({ id: schema.rules.id })
    .from(schema.rules)
    .where(and(eq(schema.rules.orgId, orgId), eq(schema.rules.ifTag, tag), eq(schema.rules.assignTo, userId)));
  return rule.id;
}

// An agent joined (or signed in for the first time): claim what the import
// left waiting for them, matched by email. The email must be the one on their
// agents row, which comes from their Clerk primary address, so an address
// typed anywhere else can't claim someone else's tickets.
export async function linkImportedAgent(orgId: string, userId: string, email: string) {
  const e = email.trim().toLowerCase();
  if (!e) return;
  const agent = await db.query.agents.findFirst({
    columns: { userId: true },
    where: and(eq(schema.agents.orgId, orgId), eq(schema.agents.userId, userId), sql`lower(${schema.agents.email}) = ${e}`, isNull(schema.agents.removedAt)),
  });
  if (!agent) return;
  await db
    .update(externalAgents)
    .set({ linkedUserId: userId })
    .where(and(eq(externalAgents.orgId, orgId), eq(externalAgents.email, e), isNull(externalAgents.linkedUserId)));
  // Only tickets nobody has picked up since the import; a ticket the team
  // reassigned in the meantime stays with whoever has it now.
  await db
    .update(schema.tickets)
    .set({ assigneeId: userId, pendingAssigneeEmail: null })
    .where(and(eq(schema.tickets.orgId, orgId), eq(schema.tickets.pendingAssigneeEmail, e), isNull(schema.tickets.assigneeId)));
  await db
    .update(schema.tickets)
    .set({ pendingAssigneeEmail: null })
    .where(and(eq(schema.tickets.orgId, orgId), eq(schema.tickets.pendingAssigneeEmail, e)));
  await db
    .update(schema.messages)
    .set({ authorId: userId })
    .where(
      and(eq(schema.messages.orgId, orgId), eq(schema.messages.authorType, "agent"), isNull(schema.messages.authorId), eq(schema.messages.authorEmail, e)),
    );
  const waiting = await db
    .select()
    .from(importedRules)
    .where(and(eq(importedRules.orgId, orgId), eq(importedRules.pendingAssigneeEmail, e)));
  for (const r of waiting) {
    if (!r.pendingTag) continue;
    const ruleId = await claimRule(orgId, r.pendingTag, userId, r.activeInSource);
    await db.update(importedRules).set({ flatdeskRuleId: ruleId, pendingTag: null, pendingAssigneeEmail: null }).where(eq(importedRules.id, r.id));
  }
}
