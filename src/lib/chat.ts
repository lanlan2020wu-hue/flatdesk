import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { attachmentsByMessage, filesFromForm, saveAttachments, type AttachmentInfo, type NewFile } from "@/lib/attachments";
import { milestone } from "@/lib/funnel";
import { identityFields } from "@/lib/chat-identity";
import { noNul } from "@/lib/ids";
import { addCustomerMessage, createTicket, parseTicketNumber } from "@/lib/tickets";

// The website chat widget. A visitor starts a conversation with their name,
// email and first message; that creates a chat ticket and returns a token the
// widget keeps in the visitor's browser to read replies and write again.
// Replies from the team (or the AI) also go to the visitor by email, so a
// closed tab doesn't lose the answer.

export const MAX_MESSAGE = 5000;
const EMAIL = /^[^\s@<>"(),;:]+@[^\s@<>"(),;:]+\.[^\s@<>"(),;:]+$/;

export async function orgByWidgetKey(key: string) {
  if (!/^[0-9a-z]{6,64}$/i.test(key)) return undefined;
  return db.query.orgs.findFirst({ where: eq(schema.orgs.widgetKey, key), columns: { id: true, name: true, chatSecret: true } });
}

// The widget posts JSON, or multipart form data when the visitor attaches
// files. Returns the fields and the files, or a readable error.
export async function readChatRequest(request: Request): Promise<{ fields: Record<string, unknown>; files: NewFile[] } | { error: string }> {
  if (!(request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const json = await request.json().catch(() => null);
    return { fields: json && typeof json === "object" ? (json as Record<string, unknown>) : {}, files: [] };
  }
  const form = await request.formData().catch(() => null);
  if (!form) return { error: "Those files couldn't be read. Please try again." };
  try {
    const files = await filesFromForm(form);
    const fields = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
    return { fields, files };
  } catch (e) {
    return { error: (e as Error).message.replace("per reply", "per message").replace("one reply", "one message") };
  }
}

// A hidden field people never see or fill in; form-filling bots usually do.
export const isBot = (fields: Record<string, unknown>) => typeof fields.website === "string" && fields.website.trim() !== "";

export function validStart(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const email = typeof b.email === "string" ? noNul(b.email).trim().toLowerCase() : "";
  const name = typeof b.name === "string" ? noNul(b.name).trim().slice(0, 120) : "";
  const message = typeof b.message === "string" ? noNul(b.message).trim().slice(0, MAX_MESSAGE) : "";
  if (!EMAIL.test(email) || email.length > 254) return { error: "Enter a valid email so we can reply." } as const;
  if (!message) return { error: "Write a message first." } as const;
  return { email, name, message, userHash: b.userHash, attributes: b.attributes } as const;
}

export async function startConversation(
  orgId: string,
  v: { email: string; name: string; message: string; userHash?: unknown; attributes?: unknown },
  files: NewFile[] = [],
  chatSecret?: string,
) {
  const token = randomBytes(24).toString("base64url");
  const firstLine = v.message.split("\n")[0].slice(0, 80);
  const ticket = await createTicket({
    orgId,
    channel: "chat",
    customerEmail: v.email,
    customerName: v.name || null,
    subject: firstLine.length < v.message.length ? `${firstLine}…` : firstLine,
    body: v.message,
    authorType: "customer",
    visitorToken: token,
    fields: chatSecret ? identityFields(chatSecret, v.email, v.userHash, v.attributes) : {},
  });
  await saveAttachments(orgId, ticket.id, ticket.messageId, files);
  await milestone(orgId, "channel_connected", { channel: "chat" });
  await milestone(orgId, "first_customer_ticket", { channel: "chat" });
  return { ticket, token };
}

export async function ticketForVisitor(orgId: string, raw: string | number, token: string) {
  const number = parseTicketNumber(raw);
  if (!number || !token) return null;
  const ticket = await db.query.tickets.findFirst({ where: and(eq(schema.tickets.orgId, orgId), eq(schema.tickets.number, number)) });
  if (!ticket?.visitorToken) return null;
  const a = Buffer.from(ticket.visitorToken);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b) ? ticket : null;
}

// What the visitor sees: never internal notes or system messages.
export async function visitorThread(ticketId: string, link?: { orgId: string; key: string; number: number; token: string }) {
  const rows = await db
    .select({
      id: schema.messages.id,
      authorType: schema.messages.authorType,
      body: schema.messages.body,
      createdAt: schema.messages.createdAt,
      emailMessageId: schema.messages.emailMessageId,
      agentName: schema.agents.name,
    })
    .from(schema.messages)
    .leftJoin(schema.agents, and(eq(schema.agents.orgId, schema.messages.orgId), eq(schema.agents.userId, schema.messages.authorId)))
    .where(and(eq(schema.messages.ticketId, ticketId), eq(schema.messages.internal, false)))
    .orderBy(asc(schema.messages.createdAt));
  // Customer messages that came in by email stay out of the widget. The chat
  // email is unverified, so a visitor who typed someone else's address must
  // not read that person's emailed replies (they'd write "this wasn't me...").
  const visible = rows.filter((m) => m.authorType !== "system" && !(m.authorType === "customer" && m.emailMessageId));
  const files = link ? await attachmentsByMessage(link.orgId, visible.map((m) => m.id)) : new Map<string, AttachmentInfo[]>();
  return visible
    .map((m) => ({
      id: m.id,
      from: m.authorType === "customer" ? "you" : m.authorType === "ai" ? "AI assistant" : (m.agentName?.split(" ")[0] ?? "Support"),
      mine: m.authorType === "customer",
      body: m.body,
      at: m.createdAt.toISOString(),
      files: link
        ? (files.get(m.id) ?? []).map((f) => ({
            name: f.filename,
            size: f.size,
            url: `/api/chat/${link.key}/${link.number}/files/${f.id}?t=${encodeURIComponent(link.token)}`,
          }))
        : [],
    }));
}

export async function visitorReply(orgId: string, ticket: { id: string; customerId: string }, message: string, files: NewFile[] = []) {
  const messageId = await addCustomerMessage({ orgId, ticketId: ticket.id, customerId: ticket.customerId, body: message.slice(0, MAX_MESSAGE) });
  await saveAttachments(orgId, ticket.id, messageId, files);
}
