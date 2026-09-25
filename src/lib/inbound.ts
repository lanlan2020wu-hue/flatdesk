import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { emailConfig, isAutoReply, matchRecipient, parseAddress, stripQuoted, ticketFromHeaders } from "@/lib/email";
import { handBackToTeam } from "@/lib/ai";
import { addCustomerMessage, createTicket } from "@/lib/tickets";

export type Inbound = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  headers: Record<string, string> | null;
  messageId: string | null;
};

export async function handleInboundEmail(mail: Inbound) {
  const target = matchRecipient(mail.to);
  if (!target) return { ignored: "no matching inbox" };
  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.inboundKey, target.key) });
  if (!org) return { ignored: "unknown inbox" };
  if (isAutoReply(mail.headers)) return { ignored: "auto-reply" };

  const sender = parseAddress(mail.from);
  if (emailConfig.from && sender.email === emailConfig.from.toLowerCase()) return { ignored: "own message" };

  // Resend retries deliveries; the Message-ID makes processing idempotent.
  if (mail.messageId) {
    const seen = await db.query.messages.findFirst({
      where: and(eq(schema.messages.orgId, org.id), eq(schema.messages.emailMessageId, mail.messageId)),
    });
    if (seen) return { ignored: "duplicate" };
  }

  const body = stripQuoted(mail.text) || "(empty message)";

  let ticketId: string | null = null;
  if (target.number) {
    const t = await db.query.tickets.findFirst({
      where: and(eq(schema.tickets.orgId, org.id), eq(schema.tickets.number, target.number)),
    });
    ticketId = t?.id ?? null;
  }
  ticketId ??= await ticketFromHeaders(org.id, mail.headers);

  if (ticketId) {
    const ticket = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, ticketId) });
    const customer = ticket && (await db.query.customers.findFirst({ where: eq(schema.customers.id, ticket.customerId) }));
    // Only the ticket's own customer can add to it; anyone else starts a new ticket.
    if (ticket && customer && customer.email === sender.email) {
      await addCustomerMessage({ orgId: org.id, ticketId, customerId: customer.id, body, emailMessageId: mail.messageId });
      await handBackToTeam(org.id, ticketId);
      return { ticket: ticket.number, action: "appended" };
    }
  }

  const ticket = await createTicket({
    orgId: org.id,
    channel: "email",
    customerEmail: sender.email,
    customerName: sender.name,
    subject: mail.subject?.trim() || "(no subject)",
    body,
    authorType: "customer",
    emailMessageId: mail.messageId,
  });
  return { ticket: ticket.number, action: "created", orgId: org.id, ticketId: ticket.id };
}
