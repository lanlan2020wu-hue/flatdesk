import { and, desc, eq, lt } from "drizzle-orm";
import { db, schema } from "@/db";

// Controls a team turns on when its company reviews Flatdesk as a vendor:
// an audit log of admin actions, a switch that keeps every ticket away from
// the AI provider, and required two-step verification. Each one is described
// on /security, so keep that page in step with this file.

export type AuditAction =
  | "settings.ai"
  | "settings.ai_processing"
  | "settings.two_factor"
  | "settings.alerts"
  | "settings.service"
  | "seat.viewer"
  | "export.download"
  | "export.archive"
  | "customer.export"
  | "customer.erase"
  | "trial.review"
  | "import.start"
  | "receipt.refund"
  | "macro.delete"
  | "billing.checkout"
  | "billing.annual"
  | "member.joined"
  | "integration.connect"
  | "integration.disconnect"
  | "apikey.create"
  | "apikey.revoke"
  | "action.change"
  | "action.decide"
  | "trigger.save"
  | "trigger.delete"
  | "group.save"
  | "group.delete"
  | "settings.routing"
  | "settings.help_domain"
  | "settings.send_address"
  | "settings.blocklist"
  | "settings.website"
  | "settings.fields"
  | "backup.save"
  | "backup.remove";

export const AUDIT_LABELS: Record<AuditAction, string> = {
  "settings.ai": "Changed AI answer settings",
  "settings.ai_processing": "Changed AI processing",
  "settings.two_factor": "Changed two-step verification",
  "settings.alerts": "Changed alerts",
  "settings.service": "Changed ratings or reply target",
  "seat.viewer": "Changed a seat",
  "export.download": "Exported data",
  "export.archive": "Downloaded the full archive",
  "customer.export": "Downloaded a customer's data",
  "customer.erase": "Erased a customer's data",
  "trial.review": "Left a trial review",
  "import.start": "Started an import",
  "receipt.refund": "Refunded an AI answer",
  "macro.delete": "Deleted a macro",
  "billing.checkout": "Opened checkout",
  "billing.annual": "Switched to yearly billing",
  "member.joined": "Joined the team",
  "integration.connect": "Connected an integration",
  "integration.disconnect": "Disconnected an integration",
  "apikey.create": "Created an API key",
  "trigger.save": "Saved a trigger",
  "trigger.delete": "Deleted a trigger",
  "group.save": "Saved a group",
  "group.delete": "Deleted a group",
  "settings.routing": "Changed how tickets are shared in turn",
  "settings.help_domain": "Changed the help center's own address",
  "settings.send_address": "Changed the address replies are sent from",
  "settings.blocklist": "Changed blocked senders",
  "settings.website": "Changed websites the AI reads",
  "settings.fields": "Changed ticket fields",
  "backup.save": "Changed backups to their own storage",
  "backup.remove": "Turned off backups to their own storage",
  "apikey.revoke": "Revoked an API key",
  "action.change": "Changed an AI action",
  "action.decide": "Approved or declined an AI action",
};

type Actor = { userId: string | null; name: string };

// Never throws: a failed log write must not undo the change it describes.
export async function audit(orgId: string, actor: Actor, action: AuditAction, detail = "") {
  try {
    await db.insert(schema.auditEvents).values({ orgId, actorId: actor.userId, actorName: actor.name, action, detail: detail.slice(0, 1000) });
  } catch (err) {
    console.error("audit write failed", action, err);
  }
}

export const AUDIT_PAGE = 100;

// Newest first. `before` pages back through older entries.
export async function auditLog(orgId: string, before?: Date, limit = AUDIT_PAGE) {
  const where = before ? and(eq(schema.auditEvents.orgId, orgId), lt(schema.auditEvents.createdAt, before)) : eq(schema.auditEvents.orgId, orgId);
  return db.select().from(schema.auditEvents).where(where).orderBy(desc(schema.auditEvents.createdAt)).limit(limit);
}

// Lists what changed between two settings objects, for the log's detail column.
export function changes(before: Record<string, unknown>, after: Record<string, unknown>, labels: Record<string, string>): string {
  const show = (v: unknown) => (typeof v === "boolean" ? (v ? "on" : "off") : v == null || v === "" ? "none" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return Object.keys(labels)
    .filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
    .map((k) => (k === "aiInstructions" ? `${labels[k]} edited` : `${labels[k]}: ${show(before[k])} → ${show(after[k])}`))
    .join("; ");
}

export class AiOffError extends Error {
  constructor() {
    super("AI processing is turned off for this team. An admin can turn it back on in Settings.");
  }
}

// The one check every call to the AI provider goes through (lib/ai.ts
// draftAnswer and lib/llm.ts structuredCall), so no feature can send a team's
// tickets out once an admin has switched AI processing off.
export async function aiProcessingAllowed(orgId: string): Promise<boolean> {
  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, orgId), columns: { aiProcessing: true } });
  return Boolean(org?.aiProcessing);
}

export async function assertAiProcessing(orgId: string) {
  if (!(await aiProcessingAllowed(orgId))) throw new AiOffError();
}
