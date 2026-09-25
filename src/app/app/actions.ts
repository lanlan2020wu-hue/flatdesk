"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireAdmin, requireSession } from "@/lib/auth";
import { deliverReply } from "@/lib/email";
import { addReply, createTicket, normalizeTags, updateTicket, type TicketStatus } from "@/lib/tickets";

const STATUSES: TicketStatus[] = ["open", "pending", "closed"];
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const status = (v: string): TicketStatus | null => (STATUSES.includes(v as TicketStatus) ? (v as TicketStatus) : null);
const tagList = (v: string) => normalizeTags(v.split(","));

export async function createTicketAction(form: FormData) {
  const s = await requireSession();
  const email = str(form, "email");
  const subject = str(form, "subject");
  const body = str(form, "body");
  if (!email || !subject || !body) throw new Error("Email, subject and message are required.");
  const ticket = await createTicket({
    orgId: s.orgId,
    channel: "email",
    customerEmail: email,
    customerName: str(form, "name") || null,
    subject,
    body,
    authorType: "customer",
    tags: tagList(str(form, "tags")),
  });
  redirect(`/app/tickets/${ticket.number}`);
}

export async function replyAction(form: FormData) {
  const s = await requireSession();
  const ticketId = str(form, "ticketId");
  const number = str(form, "number");
  const { messageId } = await addReply({
    orgId: s.orgId,
    ticketId,
    userId: s.userId,
    body: str(form, "body"),
    internal: form.get("internal") === "on",
    status: status(str(form, "status")),
    addTags: tagList(str(form, "addTags")),
  });
  if (messageId) await deliverReply(s.orgId, messageId);
  revalidatePath(`/app/tickets/${number}`);
  revalidatePath("/app/inbox");
}

export async function updateTicketAction(form: FormData) {
  const s = await requireSession();
  const ticketId = str(form, "ticketId");
  const patch: Parameters<typeof updateTicket>[2] = {};
  if (form.has("status")) patch.status = status(str(form, "status")) ?? undefined;
  if (form.has("assigneeId")) {
    const assignee = str(form, "assigneeId");
    if (assignee) {
      const member = await db.query.agents.findFirst({
        where: and(eq(schema.agents.orgId, s.orgId), eq(schema.agents.userId, assignee)),
      });
      if (!member) throw new Error("That agent isn't on this team.");
    }
    patch.assigneeId = assignee || null;
  }
  if (form.has("tags")) patch.tags = tagList(str(form, "tags"));
  await updateTicket(s.orgId, ticketId, patch);
  revalidatePath(`/app/tickets/${str(form, "number")}`);
  revalidatePath("/app/inbox");
}

export async function saveMacroAction(form: FormData) {
  const s = await requireSession();
  const values = {
    name: str(form, "name"),
    body: str(form, "body"),
    addTags: tagList(str(form, "addTags")),
    setStatus: status(str(form, "setStatus")),
  };
  if (!values.name || !values.body) throw new Error("A macro needs a name and a reply.");
  const id = str(form, "id");
  if (id) {
    await db.update(schema.macros).set(values).where(and(eq(schema.macros.orgId, s.orgId), eq(schema.macros.id, id)));
  } else {
    await db.insert(schema.macros).values({ ...values, orgId: s.orgId });
  }
  revalidatePath("/app/macros");
}

export async function deleteMacroAction(form: FormData) {
  const s = await requireSession();
  await db.delete(schema.macros).where(and(eq(schema.macros.orgId, s.orgId), eq(schema.macros.id, str(form, "id"))));
  revalidatePath("/app/macros");
}

export async function saveRuleAction(form: FormData) {
  const s = await requireAdmin();
  const [ifTag] = tagList(str(form, "ifTag"));
  const assignTo = str(form, "assignTo");
  const member = await db.query.agents.findFirst({
    where: and(eq(schema.agents.orgId, s.orgId), eq(schema.agents.userId, assignTo)),
  });
  if (!ifTag || !member) throw new Error("Pick a tag and an agent on this team.");
  await db.insert(schema.rules).values({ orgId: s.orgId, ifTag, assignTo });
  revalidatePath("/app/macros");
}

export async function toggleRuleAction(form: FormData) {
  const s = await requireAdmin();
  const id = str(form, "id");
  const enabled = str(form, "enabled") === "true";
  await db.update(schema.rules).set({ enabled }).where(and(eq(schema.rules.orgId, s.orgId), eq(schema.rules.id, id)));
  revalidatePath("/app/macros");
}

export async function deleteRuleAction(form: FormData) {
  const s = await requireAdmin();
  await db.delete(schema.rules).where(and(eq(schema.rules.orgId, s.orgId), eq(schema.rules.id, str(form, "id"))));
  revalidatePath("/app/macros");
}

export async function saveAiSettingsAction(form: FormData) {
  const s = await requireAdmin();
  const limit = str(form, "aiOverageMonthlyLimit");
  const n = Number(limit);
  await db
    .update(schema.orgs)
    .set({
      aiEnabled: form.get("aiEnabled") === "on",
      aiInstructions: str(form, "aiInstructions").slice(0, 20000),
      aiOverageEnabled: form.get("aiOverageEnabled") === "on",
      aiOverageMonthlyLimit: limit && Number.isInteger(n) && n >= 0 ? n : null,
    })
    .where(eq(schema.orgs.id, s.orgId));
  revalidatePath("/app/settings");
}
