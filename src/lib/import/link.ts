import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";

const { externalAgents, importedRules } = schema;

// An agent joined (or signed in for the first time): claim what the import
// left waiting for them, matched by email.
export async function linkImportedAgent(orgId: string, userId: string, email: string) {
  const e = email.trim().toLowerCase();
  if (!e) return;
  await db
    .update(externalAgents)
    .set({ linkedUserId: userId })
    .where(and(eq(externalAgents.orgId, orgId), eq(externalAgents.email, e), isNull(externalAgents.linkedUserId)));
  await db
    .update(schema.tickets)
    .set({ assigneeId: userId, pendingAssigneeEmail: null })
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
    const [rule] = await db
      .insert(schema.rules)
      .values({ orgId, ifTag: r.pendingTag, assignTo: userId, enabled: r.activeInSource })
      .returning({ id: schema.rules.id });
    await db.update(importedRules).set({ flatdeskRuleId: rule.id, pendingTag: null, pendingAssigneeEmail: null }).where(eq(importedRules.id, r.id));
  }
}
