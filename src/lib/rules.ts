import { db, schema } from "@/db";
import { findAssignable } from "@/lib/agents";

// "If tagged X, assign to Y". The same rule twice (a double click, two tabs)
// is kept once by the rules_org_tag_assignee index. Returns false when the
// person can't take tickets.
export async function addRule(orgId: string, ifTag: string, assignTo: string): Promise<boolean> {
  if (!ifTag || !(await findAssignable(orgId, assignTo))) return false;
  await db.insert(schema.rules).values({ orgId, ifTag, assignTo }).onConflictDoNothing({ target: [schema.rules.orgId, schema.rules.ifTag, schema.rules.assignTo] });
  return true;
}
