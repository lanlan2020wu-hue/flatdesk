// Side conversations: email a supplier, courier or another team from a ticket
// ("can you check parcel 123?"), and their answer lands back on the ticket.
//
// Each message is an internal note on the ticket (messages.side_id), so the
// customer never sees it and the AI never answers it. Replies come back by the
// token in the Reply-To (team+s<token>@inbound), or, from a connected mailbox
// or a client that ignores Reply-To, by the In-Reply-To of one of ours.

import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { replyHtml } from "@/lib/csat";
import { emailConfig, fromAddress, isDomainRefusal, parseAddress, resend, senderAddress } from "@/lib/email";

const { sideConversations, messages, tickets, customers, orgs } = schema;

export const SIDE = { perTicket: 10, bodyMax: 20_000, subjectMax: 200 };

export class SideError extends Error {}

export type SideConversation = typeof sideConversations.$inferSelect;

// The Reply-To for a side conversation: the team's inbound address with "+s" and its token.
export function sideReplyTo(inboundKey: string, token: string) {
  return emailConfig.inboundDomain ? `${inboundKey}+s${token}@${emailConfig.inboundDomain}` : null;
}

function cleanBody(body: string) {
  const text = body.replace(/\0/g, "").trim();
  if (!text) throw new SideError("Write a message first.");
  if (text.length > SIDE.bodyMax) throw new SideError(`Keep it under ${SIDE.bodyMax.toLocaleString("en-US")} characters.`);
  return text;
}

export async function startSide(input: { orgId: string; ticketId: string; userId: string; to: string; subject: string; body: string }) {
  const { email, name } = parseAddress(input.to);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new SideError("Enter the email address to write to.");
  const body = cleanBody(input.body);
  const subject = input.subject.replace(/[\r\n\0]+/g, " ").trim().slice(0, SIDE.subjectMax);
  if (!subject) throw new SideError("Give it a subject.");

  const [ticket] = await db
    .select({ id: tickets.id, deletedAt: tickets.deletedAt, mergedIntoId: tickets.mergedIntoId, customerEmail: customers.email, cc: tickets.cc })
    .from(tickets)
    .innerJoin(customers, eq(customers.id, tickets.customerId))
    .where(and(eq(tickets.orgId, input.orgId), eq(tickets.id, input.ticketId)));
  if (!ticket || ticket.deletedAt || ticket.mergedIntoId) throw new SideError("This ticket can't start side conversations right now.");
  if (email === ticket.customerEmail || ticket.cc.includes(email)) throw new SideError("That's someone on the ticket already. Reply on the ticket instead, so they see the whole conversation.");
  const existing = await db.select({ id: sideConversations.id }).from(sideConversations).where(eq(sideConversations.ticketId, ticket.id));
  if (existing.length >= SIDE.perTicket) throw new SideError(`A ticket can have up to ${SIDE.perTicket} side conversations.`);

  const { side, messageId } = await db.transaction(async (tx) => {
    const [side] = await tx
      .insert(sideConversations)
      .values({ orgId: input.orgId, ticketId: ticket.id, token: randomBytes(10).toString("hex"), toEmail: email, toName: name, subject, createdBy: input.userId })
      .returning();
    const [m] = await tx
      .insert(messages)
      .values({ orgId: input.orgId, ticketId: ticket.id, sideId: side.id, authorType: "agent", authorId: input.userId, body, internal: true })
      .returning({ id: messages.id });
    return { side, messageId: m.id };
  });
  await sendSideMessage(input.orgId, messageId);
  return side;
}

export async function replySide(input: { orgId: string; sideId: string; userId: string; body: string }) {
  const body = cleanBody(input.body);
  const side = await db.query.sideConversations.findFirst({ where: and(eq(sideConversations.orgId, input.orgId), eq(sideConversations.id, input.sideId)) });
  if (!side) throw new SideError("That side conversation is gone.");
  const [m] = await db.insert(messages).values({ orgId: input.orgId, ticketId: side.ticketId, sideId: side.id, authorType: "agent", authorId: input.userId, body, internal: true }).returning({ id: messages.id });
  await db.update(sideConversations).set({ closedAt: null, lastMessageAt: new Date() }).where(eq(sideConversations.id, side.id));
  await sendSideMessage(input.orgId, m.id);
  return side;
}

export async function closeSide(orgId: string, sideId: string, closed = true) {
  const [row] = await db
    .update(sideConversations)
    .set({ closedAt: closed ? new Date() : null })
    .where(and(eq(sideConversations.orgId, orgId), eq(sideConversations.id, sideId)))
    .returning();
  return row ?? null;
}

// The ticket's side conversations, latest activity first, with how many messages each.
export async function sidesFor(orgId: string, ticketId: string) {
  const sides = await db
    .select()
    .from(sideConversations)
    .where(and(eq(sideConversations.orgId, orgId), eq(sideConversations.ticketId, ticketId)))
    .orderBy(desc(sideConversations.lastMessageAt));
  if (sides.length === 0) return [];
  const counts = await db
    .select({ sideId: messages.sideId, authorType: messages.authorType })
    .from(messages)
    .where(inArray(messages.sideId, sides.map((s) => s.id)));
  return sides.map((s) => {
    const mine = counts.filter((c) => c.sideId === s.id);
    return { ...s, messages: mine.length, replies: mine.filter((c) => c.authorType === "system").length };
  });
}

// Emails one message of a side conversation, threaded onto the earlier ones.
export async function sendSideMessage(orgId: string, messageId: string): Promise<void> {
  const { mailboxFor, sendFromMailbox } = await import("@/lib/mailbox");
  const box = await mailboxFor(orgId);
  const shared = emailConfig.apiKey ? emailConfig.from : undefined;
  if (!box && !shared) return; // email not configured (local dev)

  const [row] = await db
    .select({ message: messages, side: sideConversations, org: orgs })
    .from(messages)
    .innerJoin(sideConversations, eq(sideConversations.id, messages.sideId))
    .innerJoin(orgs, eq(orgs.id, messages.orgId))
    .where(and(eq(messages.orgId, orgId), eq(messages.id, messageId)));
  if (!row) return;

  const earlier = await db
    .select({ id: messages.emailMessageId })
    .from(messages)
    .where(and(eq(messages.sideId, row.side.id), isNotNull(messages.emailMessageId)))
    .orderBy(asc(messages.createdAt));
  const refs = earlier.map((e) => e.id!);

  const from = box?.settings.mailbox ?? (senderAddress(row.org) || shared)!;
  const ownId = `<${row.message.id}@${from.split("@")[1]}>`;
  const headers: Record<string, string> = { "Message-ID": ownId, "X-Flatdesk-Org": orgId };
  if (refs.length) {
    headers["In-Reply-To"] = refs[refs.length - 1];
    headers["References"] = refs.slice(-10).join(" ");
  }
  const subject = refs.length && !/^re:/i.test(row.side.subject) ? `Re: ${row.side.subject}` : row.side.subject;
  const content = { to: row.side.toEmail, subject, text: row.message.body, html: replyHtml(row.message.body, null) };
  const save = (result: { error: string } | { messageId: string | null }) =>
    db
      .update(messages)
      .set("error" in result ? { deliveryError: result.error.slice(0, 300) } : { emailMessageId: result.messageId, deliveryError: null })
      .where(eq(messages.id, row.message.id));

  if (box) {
    await save(await sendFromMailbox(box, { ...content, fromName: row.org.name, headers }));
    return;
  }
  const send = (address: string, id: string) =>
    resend().emails.send({
      ...content,
      from: fromAddress(row.org.name, address),
      replyTo: sideReplyTo(row.org.inboundKey, row.side.token) ?? undefined,
      headers: { ...headers, "Message-ID": id },
    });
  let sentId = ownId;
  let { error } = await send(from, ownId);
  if (error && shared && from !== shared && isDomainRefusal(error.message)) {
    sentId = `<${row.message.id}@${shared.split("@")[1]}>`;
    ({ error } = await send(shared, sentId));
  }
  await save(error ? { error: error.message } : { messageId: sentId });
}

// The side conversation an inbound email answers, by the token in the address
// it was sent to, or by the Message-IDs it replies to.
export async function sideForInbound(orgId: string, token: string | null, headers: Record<string, string> | null): Promise<SideConversation | null> {
  if (token) {
    return (await db.query.sideConversations.findFirst({ where: and(eq(sideConversations.orgId, orgId), eq(sideConversations.token, token)) })) ?? null;
  }
  if (!headers) return null;
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const ids = `${lower["in-reply-to"] ?? ""} ${lower["references"] ?? ""}`.match(/<[^>]+>/g) ?? [];
  if (ids.length === 0) return null;
  const [hit] = await db
    .select({ side: sideConversations })
    .from(messages)
    .innerJoin(sideConversations, eq(sideConversations.id, messages.sideId))
    .where(and(eq(messages.orgId, orgId), inArray(messages.emailMessageId, ids)))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return hit?.side ?? null;
}

// An answer in a side conversation: an internal note on the ticket, which
// comes back to Open so someone acts on it.
export async function addSideReply(input: { orgId: string; side: SideConversation; from: { email: string; name: string | null }; body: string; emailMessageId: string | null }) {
  const name = input.from.name ? `${input.from.name} (${input.from.email})` : input.from.email;
  const [m] = await db
    .insert(messages)
    .values({
      orgId: input.orgId,
      ticketId: input.side.ticketId,
      sideId: input.side.id,
      authorType: "system",
      authorName: name,
      authorEmail: input.from.email,
      body: input.body,
      internal: true,
      emailMessageId: input.emailMessageId,
    })
    .returning({ id: messages.id });
  const now = new Date();
  await db.update(sideConversations).set({ closedAt: null, lastMessageAt: now }).where(eq(sideConversations.id, input.side.id));
  // Back to Open, the way a customer's reply brings it back (lib/tickets.ts addCustomerMessage).
  await db
    .update(tickets)
    .set({ status: "open", closedAt: null, timedRan: [], snoozedUntil: null, snoozedBy: null, updatedAt: now })
    .where(and(eq(tickets.orgId, input.orgId), eq(tickets.id, input.side.ticketId), isNull(tickets.deletedAt)));
  return { messageId: m.id };
}
