"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { clerkEnabled } from "@/lib/auth-config";
import { db, schema } from "@/db";
import { findAssignable } from "@/lib/agents";
import { INPUT, parseOverageLimit } from "@/lib/app-input";
import { LOCKED_MESSAGE, requireAdmin, requireEditor, requireOpen, type Session } from "@/lib/auth";
import { filesFromForm, saveAttachments } from "@/lib/attachments";
import { checkWebhookUrl, sendTestAlert } from "@/lib/alerts";
import { handBackToTeam } from "@/lib/ai";
import { checkoutUrl, portalUrl, switchToAnnual, syncSeats } from "@/lib/billing";
import { CopilotError, draftReply, rewriteText, summarizeTicket, type TicketSummary } from "@/lib/copilot";
import type { RewriteStyle } from "@/lib/copilot-config";
import { deliverReply } from "@/lib/email";
import { isUuid } from "@/lib/ids";
import { recordMacroUses } from "@/lib/macro-drift";
import { dismissSuggestion, saveSuggestedMacro } from "@/lib/macro-suggestions";
import { hit, LIMITS } from "@/lib/rate-limit";
import { teachAi } from "@/lib/teach";
import { addRule } from "@/lib/rules";
import { audit, changes } from "@/lib/security";
import { TARGET_CHOICES, validHours } from "@/lib/sla";
import { addReply, isPriority, normalizeTags, updateTicket, type TicketPriority, type TicketStatus } from "@/lib/tickets";

// The paywall hides the app once a trial ends without a card; this keeps
// direct requests from doing work behind it. Billing stays open.
const requireOpenSession = async () => requireOpen(await requireEditor());
const requireOpenAdmin = async () => requireOpen(await requireAdmin());

const actor = (s: Session) => ({ userId: s.userId, name: s.name });

const STATUSES: TicketStatus[] = ["open", "pending", "closed"];
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const status = (v: string): TicketStatus | null => (STATUSES.includes(v as TicketStatus) ? (v as TicketStatus) : null);
const tagList = (v: string) => normalizeTags(v.split(","));
// Ids come from hidden form fields; anything that isn't a uuid would be a Postgres error.
const idOf = (f: FormData, k: string) => {
  const v = str(f, k);
  if (!isUuid(v)) throw new Error("That item doesn't exist.");
  return v;
};

export async function replyAction(form: FormData) {
  const s = await requireOpenSession();
  const ticketId = idOf(form, "ticketId");
  const number = str(form, "number");
  const files = await filesFromForm(form);
  // A macro can hand the ticket to someone on the team.
  const assignTo = str(form, "assignTo");
  const assignee = assignTo ? await findAssignable(s.orgId, assignTo) : null;
  const { messageId, ticket } = await addReply({
    orgId: s.orgId,
    ticketId,
    userId: s.userId,
    body: str(form, "body"),
    internal: form.get("internal") === "on",
    status: status(str(form, "status")),
    addTags: tagList(str(form, "addTags")),
    assignTo: assignee?.userId ?? null,
    hasFiles: files.length > 0,
  });
  if (messageId && files.length) await saveAttachments(s.orgId, ticketId, messageId, files);
  if (messageId) await deliverReply(s.orgId, messageId);
  // A person on the team answered, so the AI didn't finish this conversation
  // alone: it stops counting (and isn't billed as overage). No alert, since the team is already on it.
  if (messageId && form.get("internal") !== "on" && ticket.resolvedByAi) {
    await handBackToTeam(s.orgId, ticketId, "A person on the team replied.", false);
  }
  // Which macros this reply started from, so Flatdesk can see how the team edits them.
  if (messageId && form.get("internal") !== "on") await recordMacroUses(s.orgId, messageId, str(form, "macroIds").split(",").filter(isUuid).slice(0, 20));
  revalidatePath(`/app/tickets/${number}`);
  revalidatePath("/app/inbox");
}

// The answer the AI was missing, written under its handoff note. It becomes a
// saved answer the AI reads; "Save and send" also replies to this customer.
export async function teachAiAction(form: FormData) {
  const s = await requireOpenSession();
  const ticketId = idOf(form, "ticketId");
  const { ticket, macro } = await teachAi({ orgId: s.orgId, ticketId, agentName: s.name, question: str(form, "question"), answer: str(form, "answer") });
  if (form.get("send") === "on") {
    const { messageId } = await addReply({ orgId: s.orgId, ticketId, userId: s.userId, body: macro.body, internal: false, status: "pending" });
    if (messageId) await deliverReply(s.orgId, messageId);
    if (messageId && ticket.resolvedByAi) await handBackToTeam(s.orgId, ticketId, "A person on the team replied.", false);
    if (messageId) await recordMacroUses(s.orgId, messageId, [macro.id]);
  }
  revalidatePath(`/app/tickets/${ticket.number}`);
  revalidatePath("/app/inbox");
  revalidatePath("/app/macros");
}

export async function updateTicketAction(form: FormData) {
  const s = await requireOpenSession();
  const ticketId = idOf(form, "ticketId");
  const patch: Parameters<typeof updateTicket>[2] = {};
  if (form.has("status")) patch.status = status(str(form, "status")) ?? undefined;
  if (form.has("assigneeId")) {
    const assignee = str(form, "assigneeId");
    if (assignee) {
      const member = await db.query.agents.findFirst({
        where: and(eq(schema.agents.orgId, s.orgId), eq(schema.agents.userId, assignee), isNull(schema.agents.removedAt)),
      });
      if (!member) throw new Error("That agent isn't on this team.");
      if (member.viewer) throw new Error("Viewers can't reply, so tickets can't be assigned to them.");
    }
    patch.assigneeId = assignee || null;
  }
  if (form.has("tags")) patch.tags = tagList(str(form, "tags"));
  if (form.has("priority") && isPriority(str(form, "priority"))) patch.priority = str(form, "priority") as TicketPriority;
  await updateTicket(s.orgId, ticketId, patch);
  revalidatePath(`/app/tickets/${str(form, "number")}`);
  revalidatePath("/app/inbox");
}

function checkMacroSize(name: string, body: string) {
  if (name.length > INPUT.macroName) throw new Error(`A macro name can be up to ${INPUT.macroName} characters.`);
  if (body.length > INPUT.macroBody) throw new Error(`A macro reply can be up to ${INPUT.macroBody.toLocaleString("en-US")} characters.`);
}

// Inbox bulk actions: the same changes as the ticket rail, on up to 200
// selected tickets at once. Tags are added, not replaced.
export async function bulkUpdateAction(form: FormData) {
  const s = await requireOpenSession();
  const ids = [...new Set(form.getAll("ids").map(String).filter(isUuid))].slice(0, 200);
  const back = str(form, "back").startsWith("/app/inbox") ? str(form, "back") : "/app/inbox";
  if (ids.length === 0) redirect(back);
  const patch: Parameters<typeof updateTicket>[2] = {};
  const st = status(str(form, "status"));
  if (st) patch.status = st;
  if (isPriority(str(form, "priority"))) patch.priority = str(form, "priority") as TicketPriority;
  const assignee = str(form, "assigneeId");
  if (assignee === "none") patch.assigneeId = null;
  else if (assignee) {
    const member = await db.query.agents.findFirst({
      where: and(eq(schema.agents.orgId, s.orgId), eq(schema.agents.userId, assignee), isNull(schema.agents.removedAt)),
    });
    if (!member || member.viewer) redirect(back);
    patch.assigneeId = assignee;
  }
  const addTags = tagList(str(form, "addTags"));
  const rows = await db
    .select({ id: schema.tickets.id, tags: schema.tickets.tags })
    .from(schema.tickets)
    .where(and(eq(schema.tickets.orgId, s.orgId), inArray(schema.tickets.id, ids)));
  for (const t of rows) {
    await updateTicket(s.orgId, t.id, addTags.length ? { ...patch, tags: [...t.tags, ...addTags] } : patch);
  }
  revalidatePath("/app/inbox");
  redirect(back);
}

export async function saveMacroAction(form: FormData) {
  const s = await requireOpenSession();
  const values = {
    name: str(form, "name"),
    body: str(form, "body"),
    addTags: tagList(str(form, "addTags")),
    setStatus: status(str(form, "setStatus")),
    assignTo: null as string | null,
    sendNow: form.get("sendNow") === "on",
  };
  if (!values.name || !values.body) throw new Error("A macro needs a name and a reply.");
  checkMacroSize(values.name, values.body);
  const assignTo = str(form, "assignTo");
  if (assignTo) values.assignTo = (await findAssignable(s.orgId, assignTo))?.userId ?? null;
  const id = str(form, "id");
  if (id) {
    if (!isUuid(id)) throw new Error("That macro doesn't exist.");
    await db.update(schema.macros).set(values).where(and(eq(schema.macros.orgId, s.orgId), eq(schema.macros.id, id)));
  } else {
    await db.insert(schema.macros).values({ ...values, orgId: s.orgId });
  }
  revalidatePath("/app/macros");
}

export async function deleteMacroAction(form: FormData) {
  const s = await requireOpenSession();
  const [gone] = await db
    .delete(schema.macros)
    .where(and(eq(schema.macros.orgId, s.orgId), eq(schema.macros.id, idOf(form, "id"))))
    .returning({ name: schema.macros.name });
  if (gone) await audit(s.orgId, actor(s), "macro.delete", gone.name);
  revalidatePath("/app/macros");
}

// A repeated reply Flatdesk spotted, saved as a macro (from the macros page or
// the prompt under an agent's reply).
export async function saveSuggestedMacroAction(form: FormData) {
  const s = await requireOpenSession();
  const values = { name: str(form, "name"), body: str(form, "body"), addTags: tagList(str(form, "addTags")), question: str(form, "question").slice(0, 300) || null };
  if (!values.name || !values.body) throw new Error("A macro needs a name and a reply.");
  checkMacroSize(values.name, values.body);
  await saveSuggestedMacro(s.orgId, values, { answer: str(form, "answer"), userId: s.userId });
  revalidatePath("/app/macros");
  const number = str(form, "number");
  if (number) revalidatePath(`/app/tickets/${number}`);
}

export async function dismissSuggestionAction(form: FormData) {
  const s = await requireOpenSession();
  await dismissSuggestion(s.orgId, s.userId, str(form, "answer"));
  revalidatePath("/app/macros");
  const number = str(form, "number");
  if (number) revalidatePath(`/app/tickets/${number}`);
}

// Evolving macros: apply the edit the team keeps making, or keep
// the macro as it is (that edit isn't proposed again).
// Admins only, as the macros page says.
export async function applyMacroUpdateAction(form: FormData) {
  const s = await requireOpenAdmin();
  const id = idOf(form, "id");
  const body = str(form, "body");
  if (!body) throw new Error("The updated macro is empty.");
  checkMacroSize("", body);
  await db.update(schema.macros).set({ body }).where(and(eq(schema.macros.orgId, s.orgId), eq(schema.macros.id, id)));
  revalidatePath("/app/macros");
  revalidatePath("/app/overview");
}

export async function dismissMacroUpdateAction(form: FormData) {
  const s = await requireOpenAdmin();
  const macro = await db.query.macros.findFirst({ where: and(eq(schema.macros.orgId, s.orgId), eq(schema.macros.id, idOf(form, "id"))) });
  if (!macro) return;
  await db
    .insert(schema.macroUpdateDismissals)
    .values({ orgId: s.orgId, macroId: macro.id, signature: str(form, "signature").slice(0, 40), userId: s.userId })
    .onConflictDoNothing();
  revalidatePath("/app/macros");
  revalidatePath("/app/overview");
}

export async function saveRuleAction(form: FormData) {
  const s = await requireOpenAdmin();
  const [ifTag] = tagList(str(form, "ifTag"));
  if (!(await addRule(s.orgId, ifTag ?? "", str(form, "assignTo")))) throw new Error("Pick a tag and an agent on this team.");
  revalidatePath("/app/macros");
}

export async function toggleRuleAction(form: FormData) {
  const s = await requireOpenAdmin();
  const id = idOf(form, "id");
  const enabled = str(form, "enabled") === "true";
  await db.update(schema.rules).set({ enabled }).where(and(eq(schema.rules.orgId, s.orgId), eq(schema.rules.id, id)));
  revalidatePath("/app/macros");
}

export async function deleteRuleAction(form: FormData) {
  const s = await requireOpenAdmin();
  await db.delete(schema.rules).where(and(eq(schema.rules.orgId, s.orgId), eq(schema.rules.id, idOf(form, "id"))));
  revalidatePath("/app/macros");
}

// Viewer seats are free: the member can read everything but change nothing.
export async function setViewerAction(form: FormData) {
  const s = await requireAdmin();
  const userId = str(form, "userId");
  const viewer = str(form, "viewer") === "true";
  const [changed] = await db
    .update(schema.agents)
    .set({ viewer })
    .where(and(eq(schema.agents.orgId, s.orgId), eq(schema.agents.userId, userId), eq(schema.agents.role, "agent"), isNull(schema.agents.removedAt)))
    .returning({ userId: schema.agents.userId });
  if (!changed) throw new Error("Admins always have a full seat. Pick an agent.");
  const who = await db.query.agents.findFirst({ where: and(eq(schema.agents.orgId, s.orgId), eq(schema.agents.userId, userId)), columns: { name: true } });
  await audit(s.orgId, actor(s), "seat.viewer", `${who?.name ?? userId}: ${viewer ? "viewer (read only)" : "agent"}`);
  await syncSeats(s.orgId).catch((err) => console.error("seat sync failed", err));
  revalidatePath("/app/settings");
}

export async function saveAiSettingsAction(form: FormData) {
  const s = await requireOpenAdmin();
  const before = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId) });
  const next = {
    aiEnabled: form.get("aiEnabled") === "on",
    aiInstructions: str(form, "aiInstructions").slice(0, 20000),
    aiOverageEnabled: form.get("aiOverageEnabled") === "on",
    aiOverageMonthlyLimit: parseOverageLimit(str(form, "aiOverageMonthlyLimit")),
  };
  await db.update(schema.orgs).set(next).where(eq(schema.orgs.id, s.orgId));
  const detail = changes(before ?? {}, next, { aiEnabled: "AI answers", aiInstructions: "What the AI should know", aiOverageEnabled: "Overage", aiOverageMonthlyLimit: "Overage limit" });
  if (detail) await audit(s.orgId, actor(s), "settings.ai", detail);
  revalidatePath("/app/settings");
}

// Where alerts go. A blank address turns them off.
export async function saveAlertsAction(form: FormData) {
  const s = await requireOpenAdmin();
  const raw = str(form, "alertWebhookUrl");
  const checked = raw ? checkWebhookUrl(raw) : { url: null };
  if ("error" in checked) redirect(`/app/settings?alerts=${encodeURIComponent(checked.error)}#alerts`);
  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId) });
  const changed = checked.url !== org?.alertWebhookUrl;
  const alertOn = form.get("alertOn") === "all" ? "all" : "team";
  const detail = changes(org ?? {}, { alertWebhookUrl: checked.url, alertOn }, { alertWebhookUrl: "Webhook", alertOn: "Post" });
  if (detail) await audit(s.orgId, actor(s), "settings.alerts", detail);
  await db
    .update(schema.orgs)
    .set({
      alertWebhookUrl: checked.url,
      alertOn,
      ...(changed ? { alertLastAt: null, alertLastError: null } : {}),
    })
    .where(eq(schema.orgs.id, s.orgId));
  revalidatePath("/app/settings");
}

export async function sendTestAlertAction() {
  const s = await requireOpenAdmin();
  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId) });
  if (!org?.alertWebhookUrl) redirect(`/app/settings?alerts=${encodeURIComponent("Save a webhook address first.")}#alerts`);
  // Each test is a request to an address the team chose, so they're limited.
  if (!(await hit(LIMITS.testAlert(s.orgId))).ok) redirect(`/app/settings?alerts=${encodeURIComponent("That's a lot of test alerts. Try again in an hour.")}#alerts`);
  const error = await sendTestAlert(org);
  redirect(`/app/settings?alerts=${error ? encodeURIComponent(`The test alert didn't arrive: ${error}`) : "sent"}#alerts`);
}

const hhmm = (v: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

// Satisfaction ratings and the first-reply target.
export async function saveServiceSettingsAction(form: FormData) {
  const s = await requireOpenAdmin();
  const target = Number(str(form, "firstResponseMinutes"));
  const firstResponseMinutes = TARGET_CHOICES.some((c) => c.minutes === target) ? target : null;
  let businessHours = null;
  if (form.get("useBusinessHours") === "on") {
    const end = str(form, "end") === "24:00" ? 1440 : hhmm(str(form, "end"));
    const hours = { tz: str(form, "tz"), days: form.getAll("days").map(Number), start: hhmm(str(form, "start")), end };
    if (!validHours(hours)) redirect(`/app/settings?service=${encodeURIComponent("Pick a time zone, at least one day, and opening hours at least an hour long.")}#service`);
    businessHours = hours;
  }
  const before = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId) });
  const escalateTo = str(form, "escalateTo") ? ((await findAssignable(s.orgId, str(form, "escalateTo")))?.userId ?? null) : null;
  const next = { csatEnabled: form.get("csatEnabled") === "on", firstResponseMinutes, businessHours, escalateTo };
  await db.update(schema.orgs).set(next).where(eq(schema.orgs.id, s.orgId));
  const detail = changes(before ?? {}, next, { csatEnabled: "Ratings", firstResponseMinutes: "First-reply target (minutes)", businessHours: "Business hours", escalateTo: "Escalate to" });
  if (detail) await audit(s.orgId, actor(s), "settings.service", detail);
  revalidatePath("/app/settings");
  revalidatePath("/app/inbox");
}

// Settings, Security: AI processing and required two-step verification.
export async function saveSecurityAction(form: FormData) {
  const s = await requireAdmin();
  const before = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId) });
  if (!before) throw new Error("Team not found.");
  const aiProcessing = form.get("aiProcessing") === "on";
  const requireTwoFactor = form.get("requireTwoFactor") === "on";
  // An admin can only require it once they have it, so nobody locks the whole team out.
  if (requireTwoFactor && !before.requireTwoFactor && clerkEnabled) {
    const user = await currentUser();
    if (!user?.twoFactorEnabled) redirect(`/app/settings?security=${encodeURIComponent("Turn on two-step verification for your own account first (your profile menu, Security), then require it for the team.")}#security`);
  }
  await db.update(schema.orgs).set({ aiProcessing, requireTwoFactor }).where(eq(schema.orgs.id, s.orgId));
  if (aiProcessing !== before.aiProcessing) await audit(s.orgId, actor(s), "settings.ai_processing", aiProcessing ? "AI processing on" : "AI processing off: nothing is sent to the AI provider");
  if (requireTwoFactor !== before.requireTwoFactor) await audit(s.orgId, actor(s), "settings.two_factor", requireTwoFactor ? "Required for everyone" : "No longer required");
  revalidatePath("/app", "layout");
  redirect("/app/settings?security=saved#security");
}

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function startCheckoutAction(form: FormData) {
  const s = await requireAdmin();
  const admin = await db.query.agents.findFirst({
    where: and(eq(schema.agents.orgId, s.orgId), eq(schema.agents.userId, s.userId)),
  });
  const interval = form.get("interval") === "year" ? "year" : "month";
  await audit(s.orgId, actor(s), "billing.checkout", interval === "year" ? "Yearly" : "Monthly");
  redirect(await checkoutUrl(s.orgId, admin?.email ?? "", await origin(), interval));
}

export async function switchToAnnualAction() {
  const s = await requireAdmin();
  await switchToAnnual(s.orgId);
  await audit(s.orgId, actor(s), "billing.annual");
  redirect("/app/settings?billing=annual#billing");
}

export async function openBillingPortalAction() {
  const s = await requireAdmin();
  redirect(await portalUrl(s.orgId, await origin()));
}

// ---- Copilot ----------------------------------------------------------------
// Called from the ticket page's client components; they show the error text.

type CopilotResult<T> = { ok: true; value: T } | { ok: false; error: string };

async function copilot<T>(ticketId: string, run: (s: { orgId: string; userId: string }) => Promise<T>): Promise<CopilotResult<T>> {
  if (!isUuid(ticketId)) return { ok: false, error: "That ticket doesn't exist." };
  try {
    const s = await requireOpenSession();
    return { ok: true, value: await run(s) };
  } catch (err) {
    if (err instanceof CopilotError || (err instanceof Error && err.message === LOCKED_MESSAGE)) return { ok: false, error: err.message };
    console.error("copilot failed", err);
    return { ok: false, error: "The copilot couldn't do that just now. Try again in a moment." };
  }
}

export async function copilotSummaryAction(ticketId: string): Promise<CopilotResult<TicketSummary>> {
  return copilot(ticketId, (s) => summarizeTicket(s.orgId, s.userId, ticketId));
}

export async function copilotDraftAction(ticketId: string): Promise<CopilotResult<{ reply: string; gaps: string }>> {
  return copilot(ticketId, (s) => draftReply(s.orgId, s.userId, ticketId));
}

export async function copilotRewriteAction(ticketId: string, text: string, style: RewriteStyle): Promise<CopilotResult<string>> {
  return copilot(ticketId, (s) => rewriteText(s.orgId, s.userId, ticketId, text, style));
}
