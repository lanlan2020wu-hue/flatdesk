"use server";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { clerkEnabled } from "@/lib/auth-config";
import { db, schema } from "@/db";
import { findAssignable } from "@/lib/agents";
import { INPUT, parseOverageLimit } from "@/lib/app-input";
import { LOCKED_MESSAGE, requireAdmin, requireEditor, requireOpen, type Session } from "@/lib/auth";
import { filesFromForm, saveAttachments } from "@/lib/attachments";
import { alertEvent, checkWebhookUrl, isOptionalEvent, sendTestAlert } from "@/lib/alerts";
import { parseUpdateEvery, setUpdateEvery } from "@/lib/update-timer";
import { addField, blockedFromClosing, deleteField, FieldError, missingMessage, parseFieldInput, setTicketValues, updateField } from "@/lib/ticket-fields";
import { createView, deleteView, parseViewForm, ViewError } from "@/lib/saved-views";
import { addSource, markReading, readSource, removeSource, WebSourceError } from "@/lib/web-knowledge";
import { handBackToTeam } from "@/lib/ai";
import { access, checkoutUrl, portalUrl, switchToAnnual, syncSeats } from "@/lib/billing";
import { CopilotError, draftReply, rewriteText, summarizeTicket, translateReply, translateTicket, type TicketSummary } from "@/lib/copilot";
import type { RewriteStyle } from "@/lib/copilot-config";
import { deliverReply } from "@/lib/email";
import { isUuid } from "@/lib/ids";
import { recordMacroUses } from "@/lib/macro-drift";
import { cleanAfterHoursMessage } from "@/lib/after-hours";
import { notifyFollowers, setFollowing } from "@/lib/followers";
import { notifyMentions } from "@/lib/mentions";
import { mergeTickets } from "@/lib/merge";
import { splitTicket } from "@/lib/split";
import { CustomerMergeError, mergeCustomers } from "@/lib/customer-merge";
import { deleteTag, renameTag, TagError } from "@/lib/tag-manager";
import { parseCcList } from "@/lib/cc";
import { dismissSuggestion, saveSuggestedMacro } from "@/lib/macro-suggestions";
import { hit, LIMITS } from "@/lib/rate-limit";
import { teachAi } from "@/lib/teach";
import { eraseCustomer, maskEmail } from "@/lib/customer-data";
import { parseSnoozeUntil, snoozeTicket, unsnoozeTicket } from "@/lib/snooze";
import { blockSender, isBlocked, parseBlockList, restoreTickets, trashTickets } from "@/lib/trash";
import { addRule } from "@/lib/rules";
import { audit, changes } from "@/lib/security";
import type { SlaPolicy } from "@/db/schema";
import { parseHolidays, RESOLVE_CHOICES, TARGET_CHOICES, validHours } from "@/lib/sla";
import { cancelScheduled, parseSendAt, scheduleReply, ScheduleError, sendScheduled } from "@/lib/scheduled-replies";
import { closeSide, replySide, SideError, startSide } from "@/lib/side-conversations";
import { addReply, createTicket, isPriority, normalizeTags, parseTicketNumber, updateTicket, type TicketPriority, type TicketStatus } from "@/lib/tickets";
import { findGroup, shareTicketQuietly } from "@/lib/routing";
import { isLanguage } from "@/lib/language";
import { rememberRemoved } from "@/lib/learn";
import { checkSendDomain, SendDomainError, setSendAddress } from "@/lib/send-domain";
import { disconnectMailbox, MAILBOX_NAMES, mailboxFor, type MailboxKind } from "@/lib/mailbox";

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
  const trashed = await db.query.tickets.findFirst({ where: and(eq(schema.tickets.orgId, s.orgId), eq(schema.tickets.id, ticketId)), columns: { deletedAt: true } });
  if (trashed?.deletedAt) throw new Error("This ticket is in the trash. Restore it to reply.");
  const files = await filesFromForm(form);
  // A macro can hand the ticket to someone on the team.
  const assignTo = str(form, "assignTo");
  const assignee = assignTo ? await findAssignable(s.orgId, assignTo) : null;
  const body = str(form, "body");
  // Set when the agent translated their reply into the customer's language in
  // the composer: what they wrote, shown to the team beside what was sent.
  const original = form.get("internal") === "on" ? null : str(form, "original").slice(0, 8000) || null;
  // "Send and close" with a required field empty: the reply goes, the ticket waits as pending.
  let replyStatus = status(str(form, "status"));
  const missing = replyStatus === "closed" ? (await blockedFromClosing(s.orgId, [ticketId])).get(ticketId) : undefined;
  if (missing) replyStatus = "pending";
  const { messageId, ticket } = await addReply({
    orgId: s.orgId,
    ticketId,
    userId: s.userId,
    body,
    original,
    internal: form.get("internal") === "on",
    status: replyStatus,
    addTags: tagList(str(form, "addTags")),
    assignTo: assignee?.userId ?? null,
    hasFiles: files.length > 0,
  });
  if (messageId && files.length) await saveAttachments(s.orgId, ticketId, messageId, files);
  if (messageId) await deliverReply(s.orgId, messageId);
  // Webhook events, for teams that turned them on.
  if (messageId && form.get("internal") !== "on") after(() => alertEvent(s.orgId, ticketId, "ticket.replied", s.name));
  if (replyStatus === "closed" && ticket.status !== "closed") after(() => alertEvent(s.orgId, ticketId, "ticket.closed", `Closed by ${s.name}.`));
  // Replying follows the ticket; the people already following it hear about the reply or note.
  if (messageId) {
    await setFollowing(s.orgId, ticketId, s.userId, true);
    await notifyFollowers(s.orgId, ticket, { kind: form.get("internal") === "on" ? "note" : "reply", actor: s.name, excerpt: body }, s.userId);
  }
  // "@sam" in a note emails Sam a link to the ticket.
  if (messageId && form.get("internal") === "on") await notifyMentions(s.orgId, ticket, body, actor(s));
  // A person on the team answered, so the AI didn't finish this conversation
  // alone: it stops counting (and isn't billed as overage). No alert, since the team is already on it.
  if (messageId && form.get("internal") !== "on" && ticket.resolvedByAi) {
    await handBackToTeam(s.orgId, ticketId, "A person on the team replied.", false);
  }
  // Which macros this reply started from, so Flatdesk can see how the team edits them.
  if (messageId && form.get("internal") !== "on") await recordMacroUses(s.orgId, messageId, str(form, "macroIds").split(",").filter(isUuid).slice(0, 20));
  revalidatePath(`/app/tickets/${number}`);
  revalidatePath("/app/inbox");
  if (missing) redirect(`/app/tickets/${number}?fields=${encodeURIComponent(`Sent, and left pending. ${missingMessage(missing)}`)}#fields`);
}

// Send later (lib/scheduled-replies.ts): the composer's reply, kept until the
// time the agent picked. Returns a message for the composer instead of throwing.
export async function scheduleReplyAction(form: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await requireOpenSession();
  try {
    if (form.get("internal") === "on") throw new ScheduleError("Notes are added right away. Send later is for replies.");
    if ((await filesFromForm(form)).length) throw new ScheduleError("Send later doesn't carry attachments. Send now, or remove the files.");
    const assignTo = str(form, "assignTo");
    const assignee = assignTo ? await findAssignable(s.orgId, assignTo) : null;
    await scheduleReply({
      orgId: s.orgId,
      ticketId: idOf(form, "ticketId"),
      userId: s.userId,
      body: str(form, "body"),
      original: str(form, "original").slice(0, 8000) || null,
      nextStatus: status(str(form, "status")) ?? "pending",
      addTags: tagList(str(form, "addTags")),
      assignTo: assignee?.userId ?? null,
      macroIds: str(form, "macroIds").split(",").filter(isUuid).slice(0, 20),
      sendAt: parseSendAt(str(form, "sendAt")),
    });
  } catch (err) {
    if (err instanceof ScheduleError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath(`/app/tickets/${str(form, "number")}`);
  revalidatePath("/app/inbox");
  return { ok: true };
}

export async function sendScheduledNowAction(id: string, number: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await requireOpenSession();
  if (!isUuid(id)) return { ok: false, error: "That reply is gone." };
  const r = await sendScheduled(s.orgId, id, { now: true });
  revalidatePath(`/app/tickets/${number}`);
  revalidatePath("/app/inbox");
  return r.sent ? { ok: true } : { ok: false, error: r.reason };
}

// Cancelling hands the text back to the reply box.
export async function cancelScheduledAction(id: string, number: number): Promise<{ body: string } | null> {
  const s = await requireOpenSession();
  if (!isUuid(id)) return null;
  const row = await cancelScheduled(s.orgId, id);
  revalidatePath(`/app/tickets/${number}`);
  revalidatePath("/app/inbox");
  return row ? { body: row.original ?? row.body } : null;
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
  if (form.has("groupId")) {
    const groupId = str(form, "groupId");
    if (groupId && !(await findGroup(s.orgId, groupId))) throw new Error("That group was deleted.");
    patch.groupId = groupId || null;
  }
  if (patch.status === "closed") {
    const missing = (await blockedFromClosing(s.orgId, [ticketId])).get(ticketId);
    if (missing) redirect(`/app/tickets/${str(form, "number")}?fields=${encodeURIComponent(missingMessage(missing))}#fields`);
  }
  const before = await db.query.tickets.findFirst({ where: and(eq(schema.tickets.orgId, s.orgId), eq(schema.tickets.id, ticketId)), columns: { status: true, assigneeId: true } });
  await updateTicket(s.orgId, ticketId, patch);
  if (patch.status === "closed" && before?.status !== "closed") after(() => alertEvent(s.orgId, ticketId, "ticket.closed", `Closed by ${s.name}.`));
  if (patch.assigneeId !== undefined && patch.assigneeId !== before?.assigneeId) {
    const to = patch.assigneeId ? (await findAssignable(s.orgId, patch.assigneeId))?.name : null;
    after(() => alertEvent(s.orgId, ticketId, "ticket.assigned", to ? `Assigned to ${to}` : "Unassigned"));
  }
  // Sent to a group that shares tickets in turn, with nobody on it yet.
  if (patch.groupId) await shareTicketQuietly(s.orgId, ticketId);
  revalidatePath(`/app/tickets/${str(form, "number")}`);
  revalidatePath("/app/inbox");
}

function checkMacroSize(name: string, body: string) {
  if (name.length > INPUT.macroName) throw new Error(`A macro name can be up to ${INPUT.macroName} characters.`);
  if (body.length > INPUT.macroBody) throw new Error(`A macro reply can be up to ${INPUT.macroBody.toLocaleString("en-US")} characters.`);
}

// Merge this ticket into another (by number). Goes to the merged ticket.
export async function mergeTicketAction(form: FormData) {
  const s = await requireOpenSession();
  const ticketId = idOf(form, "ticketId");
  const number = str(form, "number");
  const into = parseTicketNumber(str(form, "into").replace(/^#/, ""));
  if (!into) redirect(`/app/tickets/${number}?merge=${encodeURIComponent("Enter the number of the ticket to merge into, like 1042.")}`);
  const result = await mergeTickets(s.orgId, ticketId, into, s.name);
  if ("error" in result) redirect(`/app/tickets/${number}?merge=${encodeURIComponent(result.error)}`);
  revalidatePath("/app/inbox");
  redirect(`/app/tickets/${result.number}`);
}

// The team starts the conversation: an email to a customer who hasn't written in.
export async function composeTicketAction(form: FormData) {
  const s = await requireOpenSession();
  const to = str(form, "to").toLowerCase();
  const name = str(form, "name") || null;
  const subject = str(form, "subject").slice(0, 200);
  const body = str(form, "body");
  const fail = (m: string) => redirect(`/app/tickets/compose?${new URLSearchParams({ error: m, to, name: name ?? "", subject, body })}`);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || to.length > 254) fail("Enter a valid email address.");
  if (!subject) fail("Add a subject.");
  if (!body) fail("Write the message.");
  if (!(await hit(LIMITS.outboundEmail(s.orgId, s.userId))).ok) fail("That's a lot of new emails. Try again in an hour.");
  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId), columns: { blockedSenders: true } });
  if (org && isBlocked(org.blockedSenders, to)) fail("That address is on your blocked senders list.");
  const files = await filesFromForm(form);
  const ticket = await createTicket({ orgId: s.orgId, channel: "email", customerEmail: to, customerName: name, subject, body, authorType: "agent", authorId: s.userId, tags: tagList(str(form, "tags")) });
  await db.update(schema.tickets).set({ status: "pending", assigneeId: ticket.assigneeId ?? s.userId }).where(eq(schema.tickets.id, ticket.id));
  if (files.length) await saveAttachments(s.orgId, ticket.id, ticket.messageId, files);
  await deliverReply(s.orgId, ticket.messageId);
  await setFollowing(s.orgId, ticket.id, s.userId, true);
  revalidatePath("/app/inbox");
  redirect(`/app/tickets/${ticket.number}`);
}

// Pull one later message out of a ticket into a ticket of its own, for when a
// customer raises a second problem in the middle of the first.
export async function splitTicketAction(form: FormData) {
  const s = await requireOpenSession();
  const messageId = idOf(form, "messageId");
  const number = str(form, "number");
  const result = await splitTicket(s.orgId, messageId, s.name);
  if ("error" in result) redirect(`/app/tickets/${number}?split=${encodeURIComponent(result.error)}`);
  await audit(s.orgId, actor(s), "ticket.split", `Split into #${result.number} from #${number}`);
  revalidatePath("/app/inbox");
  redirect(`/app/tickets/${result.number}`);
}

// Two records for one person: everything moves to the one whose email is typed.
export async function mergeCustomersAction(form: FormData) {
  const s = await requireOpen(await requireAdmin());
  const customerId = idOf(form, "customerId");
  const number = str(form, "number");
  let into: string;
  try {
    into = (await mergeCustomers(s.orgId, customerId, str(form, "into"))).email;
  } catch (e) {
    if (e instanceof CustomerMergeError) redirect(`/app/tickets/${number}?customers=${encodeURIComponent(e.message)}#merge-customers`);
    throw e;
  }
  await audit(s.orgId, actor(s), "customer.merge", `Merged customer record into ${maskEmail(into)}`);
  revalidatePath("/app/inbox");
  redirect(`/app/tickets/${number}`);
}

export async function renameTagAction(form: FormData) {
  const s = await requireOpenAdmin();
  let msg: string;
  try {
    const n = await renameTag(s.orgId, str(form, "from"), str(form, "to"));
    msg = `Renamed on ${n} ${n === 1 ? "ticket" : "tickets"}.`;
    await audit(s.orgId, actor(s), "tags.change", `Renamed tag ${str(form, "from")} to ${str(form, "to")} on ${n} tickets`);
  } catch (e) {
    if (!(e instanceof TagError)) throw e;
    msg = e.message;
  }
  revalidatePath("/app/settings/tags");
  redirect(`/app/settings/tags?msg=${encodeURIComponent(msg)}`);
}

export async function deleteTagAction(form: FormData) {
  const s = await requireOpenAdmin();
  const n = await deleteTag(s.orgId, str(form, "tag"));
  await audit(s.orgId, actor(s), "tags.change", `Removed tag ${str(form, "tag")} from ${n} tickets`);
  revalidatePath("/app/settings/tags");
  redirect(`/app/settings/tags?msg=${encodeURIComponent(`Removed from ${n} ${n === 1 ? "ticket" : "tickets"}.`)}`);
}

// Delete, restore, or delete and block the sender, from a ticket's rail.
export async function ticketTrashAction(form: FormData) {
  const s = await requireOpenSession();
  const ticketId = idOf(form, "ticketId");
  const op = str(form, "op");
  if (op === "restore") {
    await restoreTickets(s.orgId, [ticketId], s.name);
    revalidatePath(`/app/tickets/${str(form, "number")}`);
    revalidatePath("/app/inbox");
    return;
  }
  if (op === "block") {
    const [row] = await db
      .select({ email: schema.customers.email })
      .from(schema.tickets)
      .innerJoin(schema.customers, eq(schema.customers.id, schema.tickets.customerId))
      .where(and(eq(schema.tickets.orgId, s.orgId), eq(schema.tickets.id, ticketId)));
    const entry = row && (await blockSender(s.orgId, row.email));
    if (entry) await audit(s.orgId, actor(s), "settings.blocklist", `Blocked ${entry}`);
    await trashTickets(s.orgId, [ticketId], s.name, entry ? `Moved to the trash by ${s.name}, who blocked ${entry}. Their future email goes straight to the trash.` : undefined);
  } else if (op === "trash") {
    await trashTickets(s.orgId, [ticketId], s.name);
  } else {
    return;
  }
  revalidatePath("/app/inbox");
  redirect("/app/inbox");
}

// Snooze a ticket until a time picked on its page, or wake it now.
export async function ticketSnoozeAction(form: FormData) {
  const s = await requireOpenSession();
  const ticketId = idOf(form, "ticketId");
  if (str(form, "op") === "wake") {
    await unsnoozeTicket(s.orgId, ticketId, s.name);
    revalidatePath(`/app/tickets/${str(form, "number")}`);
    revalidatePath("/app/inbox");
    return;
  }
  const until = parseSnoozeUntil(form.get("until"));
  if (!until) return;
  await snoozeTicket(s.orgId, ticketId, until, s.name);
  revalidatePath("/app/inbox");
  redirect("/app/inbox");
}

// Erases one customer and everything about them, on their request. Admins
// only, confirmed by typing the address. Works after a trial ends too: a
// data request can't wait for billing.
export async function eraseCustomerAction(form: FormData) {
  const s = await requireAdmin();
  const customerId = idOf(form, "customerId");
  const back = `/app/tickets/${parseTicketNumber(str(form, "number")) ?? ""}`;
  const customer = await db.query.customers.findFirst({ where: and(eq(schema.customers.orgId, s.orgId), eq(schema.customers.id, customerId)), columns: { email: true } });
  if (!customer) redirect("/app/inbox");
  if (str(form, "confirm").trim().toLowerCase() !== customer.email.toLowerCase()) redirect(`${back}?erase=mismatch#erase`);
  const gone = await eraseCustomer(s.orgId, customerId);
  if (gone) {
    await audit(s.orgId, actor(s), "customer.erase", `${maskEmail(gone.email)}: ${gone.tickets} ${gone.tickets === 1 ? "ticket" : "tickets"}${gone.otherMessages ? `, ${gone.otherMessages} ${gone.otherMessages === 1 ? "message" : "messages"} on other tickets` : ""}`);
  }
  revalidatePath("/app/inbox");
  redirect("/app/inbox?erased=1");
}

// Settings: the senders whose email goes straight to the trash.
export async function saveBlocklistAction(form: FormData) {
  const s = await requireOpenAdmin();
  const { list, rejected } = parseBlockList(String(form.get("blocked") ?? "").slice(0, 40_000));
  const before = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId), columns: { blockedSenders: true } });
  await db.update(schema.orgs).set({ blockedSenders: list }).where(eq(schema.orgs.id, s.orgId));
  const added = list.filter((e) => !before?.blockedSenders.includes(e));
  const removed = (before?.blockedSenders ?? []).filter((e) => !list.includes(e));
  if (added.length || removed.length) {
    await audit(s.orgId, actor(s), "settings.blocklist", [added.length ? `Blocked ${added.join(", ")}` : "", removed.length ? `Unblocked ${removed.join(", ")}` : ""].filter(Boolean).join(". "));
  }
  revalidatePath("/app/settings");
  if (rejected.length) redirect(`/app/settings?blocked=${encodeURIComponent(`Not an email address or domain, so left out: ${rejected.slice(0, 5).join(", ")}`)}#blocked`);
}

// The people copied on a ticket's replies, from the rail.
export async function saveCcAction(form: FormData) {
  const s = await requireOpenSession();
  const ticketId = idOf(form, "ticketId");
  const number = str(form, "number");
  const row = await db
    .select({ email: schema.customers.email, channel: schema.tickets.channel })
    .from(schema.tickets)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.tickets.customerId))
    .where(and(eq(schema.tickets.orgId, s.orgId), eq(schema.tickets.id, ticketId)));
  if (!row[0]) throw new Error("That ticket doesn't exist.");
  const cc = parseCcList(str(form, "cc"), row[0].email);
  if ("error" in cc) redirect(`/app/tickets/${number}?cc=${encodeURIComponent(cc.error)}`);
  await db.update(schema.tickets).set({ cc }).where(and(eq(schema.tickets.orgId, s.orgId), eq(schema.tickets.id, ticketId)));
  revalidatePath(`/app/tickets/${number}`);
}

// Follow or stop following a ticket (lib/followers.ts).
export async function followTicketAction(form: FormData) {
  const s = await requireOpenSession();
  await setFollowing(s.orgId, idOf(form, "ticketId"), s.userId, form.get("on") === "1");
  revalidatePath(`/app/tickets/${str(form, "number")}`);
}

// Your own daily summary email (lib/digest.ts).
export async function saveDigestAction(form: FormData) {
  const s = await requireOpenSession();
  await db.update(schema.agents).set({ digest: form.get("digest") === "on" }).where(and(eq(schema.agents.orgId, s.orgId), eq(schema.agents.userId, s.userId)));
  revalidatePath("/app/settings");
}

// Your own reply signature.
export async function saveSignatureAction(form: FormData) {
  const s = await requireOpenSession();
  const signature = String(form.get("signature") ?? "").replace(/\0/g, "").trim().slice(0, 1000);
  await db.update(schema.agents).set({ signature }).where(and(eq(schema.agents.orgId, s.orgId), eq(schema.agents.userId, s.userId)));
  revalidatePath("/app/settings");
}

// A trial admin's honest review earns the team PLAN.trialReviewBonus extra AI
// answers, once. Any rating counts, so the bonus never rewards praise.
export async function trialReviewAction(form: FormData) {
  const s = await requireOpenAdmin();
  const rating = Number(str(form, "rating"));
  const text = String(form.get("review") ?? "").replace(/\0/g, "").trim().slice(0, 1000);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || text.length < 40) redirect("/app/overview?review=invalid#review");
  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId) });
  if (!org || org.reviewedAt || access(org).state !== "trial") redirect("/app/overview");
  const [saved] = await db
    .update(schema.orgs)
    .set({ reviewedAt: new Date(), reviewRating: rating, reviewText: text, reviewPublic: str(form, "public") === "on" })
    .where(and(eq(schema.orgs.id, s.orgId), isNull(schema.orgs.reviewedAt)))
    .returning({ id: schema.orgs.id });
  if (saved) await audit(s.orgId, actor(s), "trial.review", `${rating} of 5`);
  revalidatePath("/app", "layout");
  redirect("/app/overview?review=thanks");
}

// Inbox bulk actions: the same changes as the ticket rail, on up to 200
// selected tickets at once. Tags are added, not replaced.
export async function bulkUpdateAction(form: FormData) {
  const s = await requireOpenSession();
  const ids = [...new Set(form.getAll("ids").map(String).filter(isUuid))].slice(0, 200);
  const back = str(form, "back").startsWith("/app/inbox") ? str(form, "back") : "/app/inbox";
  if (ids.length === 0) redirect(back);
  const op = str(form, "op");
  if (op === "trash" || op === "restore") {
    await (op === "trash" ? trashTickets : restoreTickets)(s.orgId, ids, s.name);
    revalidatePath("/app/inbox");
    redirect(back);
  }
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
  const groupId = str(form, "groupId");
  if (groupId === "none") patch.groupId = null;
  else if (groupId) {
    if (!(await findGroup(s.orgId, groupId))) redirect(back);
    patch.groupId = groupId;
  }
  const addTags = tagList(str(form, "addTags"));
  const rows = await db
    .select({ id: schema.tickets.id, tags: schema.tickets.tags })
    .from(schema.tickets)
    .where(and(eq(schema.tickets.orgId, s.orgId), inArray(schema.tickets.id, ids)));
  // Closing skips tickets with a required field empty; the rest of the change still applies to them.
  const blocked = patch.status === "closed" ? await blockedFromClosing(s.orgId, rows.map((r) => r.id)) : new Map<string, string[]>();
  for (const t of rows) {
    const own = blocked.has(t.id) ? { ...patch, status: undefined } : patch;
    await updateTicket(s.orgId, t.id, addTags.length ? { ...own, tags: [...t.tags, ...addTags] } : own);
    if (patch.groupId) await shareTicketQuietly(s.orgId, t.id);
  }
  revalidatePath("/app/inbox");
  if (blocked.size) {
    const names = [...new Set([...blocked.values()].flat())];
    const msg = `${blocked.size} ticket${blocked.size === 1 ? " wasn't" : "s weren't"} closed: fill in ${names.join(", ")} first.`;
    redirect(`${back}${back.includes("?") ? "&" : "?"}notice=${encodeURIComponent(msg)}`);
  }
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
    .returning({ id: schema.macros.id, name: schema.macros.name, source: schema.macros.source });
  if (gone) {
    await audit(s.orgId, actor(s), "macro.delete", gone.name);
    await rememberRemoved(s.orgId, gone);
  }
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
    aiAutoLearn: form.get("aiAutoLearn") === "on",
    aiTriage: form.get("aiTriage") === "on",
  };
  await db.update(schema.orgs).set(next).where(eq(schema.orgs.id, s.orgId));
  const detail = changes(before ?? {}, next, { aiEnabled: "AI answers", aiInstructions: "What the AI should know", aiOverageEnabled: "Overage", aiOverageMonthlyLimit: "Overage limit", aiAutoLearn: "Learn from solved tickets", aiTriage: "Sort new tickets" });
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
      alertEvents: form.getAll("alertEvents").map(String).filter(isOptionalEvent),
      ...(changed ? { alertLastAt: null, alertLastError: null } : {}),
    })
    .where(eq(schema.orgs.id, s.orgId));
  revalidatePath("/app/settings");
}

// Set how often the customer is promised an update on this ticket (blank turns it off).
export async function setUpdateEveryAction(form: FormData) {
  const s = await requireOpenSession();
  const ticketId = idOf(form, "ticketId");
  await setUpdateEvery(s.orgId, ticketId, parseUpdateEvery(str(form, "every")));
  revalidatePath(`/app/tickets/${str(form, "number")}`);
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
    const holidays = parseHolidays(String(form.get("holidays") ?? ""));
    if (holidays.rejected.length) redirect(`/app/settings?service=${encodeURIComponent(`Closed dates should look like 2026-12-25. Couldn't read: ${holidays.rejected.slice(0, 3).join(", ")}.`)}#service`);
    const hours = { tz: str(form, "tz"), days: form.getAll("days").map(Number), start: hhmm(str(form, "start")), end, ...(holidays.list.length ? { holidays: holidays.list } : {}) };
    if (!validHours(hours)) redirect(`/app/settings?service=${encodeURIComponent("Pick a time zone, at least one day, and opening hours at least an hour long.")}#service`);
    businessHours = hours;
  }
  const before = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId) });
  const escalateTo = str(form, "escalateTo") ? ((await findAssignable(s.orgId, str(form, "escalateTo")))?.userId ?? null) : null;
  const resolve = (v: string) => (RESOLVE_CHOICES.some((c) => c.minutes === Number(v)) ? Number(v) : null);
  const resolveMinutes = resolve(str(form, "resolveMinutes"));
  const nextTarget = Number(str(form, "nextReplyMinutes"));
  const nextReplyMinutes = TARGET_CHOICES.some((c) => c.minutes === nextTarget) ? nextTarget : null;
  const pauseWhilePending = form.get("pauseWhilePending") === "on";
  const slaPolicies: SlaPolicy[] = [];
  for (let i = 0; i < 4; i++) {
    const [tag] = tagList(str(form, `policyTag${i}`));
    const minutes = Number(str(form, `policyMinutes${i}`));
    const resolveFor = resolve(str(form, `policyResolve${i}`));
    if (tag && TARGET_CHOICES.some((c) => c.minutes === minutes) && !slaPolicies.some((p) => p.tag === tag)) slaPolicies.push({ tag, minutes, ...(resolveFor ? { resolveMinutes: resolveFor } : {}) });
  }
  const afterHoursMessage = cleanAfterHoursMessage(form.get("afterHoursMessage"));
  const ackMessage = cleanAfterHoursMessage(form.get("ackMessage"));
  const next = { csatEnabled: form.get("csatEnabled") === "on", afterHoursMessage, ackMessage, firstResponseMinutes, nextReplyMinutes, resolveMinutes, pauseWhilePending, businessHours, escalateTo, slaPolicies };
  await db.update(schema.orgs).set(next).where(eq(schema.orgs.id, s.orgId));
  const detail = changes(before ?? {}, next, { csatEnabled: "Ratings", afterHoursMessage: "After-hours reply", ackMessage: "Acknowledgement email", firstResponseMinutes: "First-reply target (minutes)", nextReplyMinutes: "Next-reply target (minutes)", pauseWhilePending: "Pause resolution clock while pending", resolveMinutes: "Resolution target (minutes)", businessHours: "Business hours", escalateTo: "Escalate to", slaPolicies: "Targets by tag" });
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

export async function copilotTranslateAction(ticketId: string, text: string, to: string): Promise<CopilotResult<string>> {
  return copilot(ticketId, (s) => translateReply(s.orgId, s.userId, ticketId, text, to));
}

// Translates the ticket's customer messages that aren't in the team's
// language, when someone opens it. Quiet on failure: the originals still show.
export async function translateTicketAction(ticketId: string): Promise<number> {
  const s = await requireOpenSession();
  if (!isUuid(ticketId) || s.viewer) return 0;
  try {
    return await translateTicket(s.orgId, s.userId, ticketId);
  } catch (err) {
    if (!(err instanceof CopilotError)) console.error("translating ticket failed", err);
    return 0;
  }
}

export async function saveLanguageAction(form: FormData) {
  const s = await requireOpenAdmin();
  const language = str(form, "language");
  if (!isLanguage(language)) return;
  await db.update(schema.orgs).set({ language }).where(eq(schema.orgs.id, s.orgId));
  revalidatePath("/app/settings");
}

// ---- Sending from the team's own address -------------------------------------------

const sendBack = (notice: string): never => redirect(`/app/settings?send=${encodeURIComponent(notice)}#sending`);

export async function saveSendAddressAction(form: FormData) {
  const s = await requireOpen(await requireAdmin());
  const before = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId), columns: { sendAddress: true } });
  const raw = String(form.get("sendAddress") ?? "").trim().slice(0, 320);
  if (raw.toLowerCase() === (before?.sendAddress ?? "")) sendBack("unchanged");
  try {
    await setSendAddress(s.orgId, raw || null);
  } catch (err) {
    if (err instanceof SendDomainError) sendBack(err.message);
    throw err;
  }
  await audit(s.orgId, actor(s), "settings.send_address", raw ? `${before?.sendAddress ?? "shared address"} → ${raw.toLowerCase()}` : `Removed ${before?.sendAddress}`);
  sendBack(raw ? "saved" : "removed");
}

export async function checkSendAddressAction() {
  const s = await requireOpen(await requireAdmin());
  const state = await checkSendDomain(s.orgId);
  sendBack(state === "verified" ? "verified" : state === "pending" ? "pending" : "Couldn't check just now. Try again in a minute.");
}

// ---- A connected mailbox --------------------------------------------------------------

export async function disconnectMailboxAction() {
  const s = await requireAdmin();
  const row = await mailboxFor(s.orgId);
  if (row) {
    await disconnectMailbox(s.orgId);
    await audit(s.orgId, actor(s), "integration.disconnect", `${MAILBOX_NAMES[row.kind as MailboxKind]}: ${row.account}`);
  }
  redirect("/app/settings?mailbox=disconnected#mailbox");
}

// ---- Websites the AI reads (lib/web-knowledge.ts) ----

const webBack = (msg?: string) => redirect(`/app/settings${msg ? `?web=${encodeURIComponent(msg)}` : ""}#websites`);

export async function addWebSourceAction(form: FormData) {
  const s = await requireOpenAdmin();
  let error: string | undefined;
  try {
    const source = await addSource(s.orgId, str(form, "url").slice(0, 2000));
    await audit(s.orgId, actor(s), "settings.website", `Added ${source.url}`);
    after(() => readSource(s.orgId, source.id));
  } catch (err) {
    if (!(err instanceof WebSourceError)) throw err;
    error = err.message;
  }
  revalidatePath("/app/settings");
  webBack(error);
}

export async function readWebSourceAction(form: FormData) {
  const s = await requireOpenAdmin();
  const id = idOf(form, "id");
  if (!(await markReading(s.orgId, id))) webBack("That address was read a few minutes ago. Try again shortly.");
  after(() => readSource(s.orgId, id));
  revalidatePath("/app/settings");
  webBack();
}

export async function removeWebSourceAction(form: FormData) {
  const s = await requireOpenAdmin();
  const removed = await removeSource(s.orgId, idOf(form, "id"));
  if (removed) await audit(s.orgId, actor(s), "settings.website", `Removed ${removed.url}`);
  revalidatePath("/app/settings");
  webBack();
}

// ---- Custom ticket fields (lib/ticket-fields.ts) ----

const fieldsBack = (msg?: string) => redirect(`/app/settings${msg ? `?fields=${encodeURIComponent(msg)}` : ""}#fields`);

export async function saveTicketFieldsAction(form: FormData) {
  const s = await requireOpenSession();
  const ticketId = idOf(form, "ticketId");
  const number = str(form, "number");
  let error: string | undefined;
  try {
    await setTicketValues(s.orgId, ticketId, (name) => (form.has(`f:${name}`) ? str(form, `f:${name}`) : null));
  } catch (err) {
    if (!(err instanceof FieldError)) throw err;
    error = err.message;
  }
  revalidatePath(`/app/tickets/${number}`);
  if (error) redirect(`/app/tickets/${number}?fields=${encodeURIComponent(error)}#fields`);
}

export async function saveFieldDefinitionAction(form: FormData) {
  const s = await requireOpenAdmin();
  const id = str(form, "id");
  let error: string | undefined;
  try {
    const input = parseFieldInput((k) => str(form, k));
    if (id) {
      const { before, row } = await updateField(s.orgId, idOf(form, "id"), input);
      await audit(s.orgId, actor(s), "settings.fields", before.name === row.name ? `Changed ${row.name}` : `Renamed ${before.name} to ${row.name}`);
    } else {
      const row = await addField(s.orgId, input);
      await audit(s.orgId, actor(s), "settings.fields", `Added ${row.name}`);
    }
  } catch (err) {
    if (!(err instanceof FieldError)) throw err;
    error = err.message;
  }
  revalidatePath("/app/settings");
  fieldsBack(error);
}

export async function deleteFieldDefinitionAction(form: FormData) {
  const s = await requireOpenAdmin();
  const removed = await deleteField(s.orgId, idOf(form, "id"));
  if (removed) await audit(s.orgId, actor(s), "settings.fields", `Deleted ${removed.name}`);
  revalidatePath("/app/settings");
  fieldsBack();
}

// ---- Saved inbox views (lib/saved-views.ts) ----

export async function createViewAction(form: FormData) {
  const s = await requireOpenSession();
  let target = "/app/inbox";
  try {
    const input = parseViewForm((k) => str(form, k), (k) => form.getAll(k).map(String));
    const view = await createView(s.orgId, s.userId, s.role === "admin", input);
    target = `/app/inbox?sv=${view.id}`;
  } catch (err) {
    if (!(err instanceof ViewError)) throw err;
    target = `/app/inbox?newview=${encodeURIComponent(err.message)}`;
  }
  revalidatePath("/app/inbox");
  redirect(target);
}

export async function deleteViewAction(form: FormData) {
  const s = await requireOpenSession();
  try {
    await deleteView(s.orgId, s.userId, s.role === "admin", str(form, "id"));
  } catch (err) {
    if (!(err instanceof ViewError)) throw err;
    redirect(`/app/inbox?sv=${encodeURIComponent(str(form, "id"))}&notice=${encodeURIComponent(err.message)}`);
  }
  revalidatePath("/app/inbox");
  redirect("/app/inbox");
}

// Side conversations (lib/side-conversations.ts): email someone outside the ticket.
export async function startSideAction(form: FormData) {
  const s = await requireOpenSession();
  const number = str(form, "number");
  let error = "";
  try {
    const quote = form.get("quote") === "on" ? await lastCustomerMessage(s.orgId, idOf(form, "ticketId")) : null;
    const body = quote ? `${str(form, "body").trim()}\n\n---\nFrom the customer:\n${quote}` : str(form, "body");
    await startSide({ orgId: s.orgId, ticketId: idOf(form, "ticketId"), userId: s.userId, to: str(form, "to"), subject: str(form, "subject"), body });
  } catch (err) {
    if (!(err instanceof SideError)) throw err;
    error = err.message;
  }
  if (error) redirect(`/app/tickets/${number}?side=${encodeURIComponent(error)}#side-conversations`);
  revalidatePath(`/app/tickets/${number}`);
}

export async function replySideAction(form: FormData) {
  const s = await requireOpenSession();
  const number = str(form, "number");
  let error = "";
  try {
    await replySide({ orgId: s.orgId, sideId: idOf(form, "sideId"), userId: s.userId, body: str(form, "body") });
  } catch (err) {
    if (!(err instanceof SideError)) throw err;
    error = err.message;
  }
  if (error) redirect(`/app/tickets/${number}?side=${encodeURIComponent(error)}#side-conversations`);
  revalidatePath(`/app/tickets/${number}`);
}

export async function closeSideAction(form: FormData) {
  const s = await requireOpenSession();
  await closeSide(s.orgId, idOf(form, "sideId"), form.get("op") !== "reopen");
  revalidatePath(`/app/tickets/${str(form, "number")}`);
}

async function lastCustomerMessage(orgId: string, ticketId: string) {
  const [m] = await db
    .select({ body: schema.messages.body })
    .from(schema.messages)
    .where(and(eq(schema.messages.orgId, orgId), eq(schema.messages.ticketId, ticketId), eq(schema.messages.authorType, "customer"), eq(schema.messages.internal, false)))
    .orderBy(desc(schema.messages.createdAt))
    .limit(1);
  return m?.body.slice(0, 5000) ?? null;
}
