import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { emailConfig, isAutoReply, matchRecipient, parseAddress, stripQuoted, ticketFromHeaders } from "@/lib/email";
import { TEST_TAG, updateOnboarding } from "@/lib/onboarding";
import { saveAttachments, type NewFile } from "@/lib/attachments";
import { addCustomerMessage, createTicket } from "@/lib/tickets";

// The same email delivered twice at once gets past the check above; the unique
// index on (org, Message-ID) stops the second copy, which is then ignored.
function duplicate(err: unknown): null {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const pg = e?.code ? e : e?.cause;
  if (pg?.code === "23505" && pg.constraint === "messages_org_email_message_id") return null;
  throw err;
}

export type Inbound = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  headers: Record<string, string> | null;
  messageId: string | null;
  // Fetches the email's files; only called once the email is known to become a message.
  attachments?: () => Promise<{ files: NewFile[]; skipped: string[] }>;
};

async function storeFiles(mail: Inbound, orgId: string, ticketId: string, messageId: string) {
  if (!mail.attachments) return;
  let files: NewFile[] = [];
  let skipped: string[] = [];
  try {
    ({ files, skipped } = await mail.attachments());
    await saveAttachments(orgId, ticketId, messageId, files);
  } catch (err) {
    // The message is already saved; a retry of the webhook would be skipped as a duplicate.
    console.error("saving attachments failed", err);
    skipped = files.length ? files.map((f) => f.filename) : ["the email's attachments"];
  }
  if (skipped.length) {
    await db.insert(schema.messages).values({
      orgId,
      ticketId,
      authorType: "system",
      internal: true,
      body: `Some attachments on this email couldn't be kept (Flatdesk keeps up to 20 MB per file and 30 MB per email). Ask the customer to send them another way if you need them: ${skipped.join(", ")}`,
    });
  }
}

export async function handleInboundEmail(mail: Inbound) {
  const target = matchRecipient(mail.to);
  if (!target) return { ignored: "no matching inbox" };
  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.inboundKey, target.key) });
  if (!org) return { ignored: "unknown inbox" };

  const sender = parseAddress(mail.from);

  // Gmail asks the forwarding address to confirm before it forwards anything.
  // Show the code in onboarding instead of opening a ticket for it.
  if (sender.email === "forwarding-noreply@google.com") {
    const code = /\(#(\d+)\)/.exec(mail.subject ?? "")?.[1] ?? /confirmation code:\s*(\d+)/i.exec(mail.text)?.[1] ?? null;
    const link = /https:\/\/mail(?:-settings)?\.google\.com\/mail\/\S+/.exec(mail.text)?.[0] ?? null;
    await updateOnboarding(org.id, (ob) => ({ ...ob, gmailConfirmation: { code, link, receivedAt: new Date().toISOString() } }));
    return { ignored: "gmail forwarding confirmation" };
  }

  // The onboarding test email: sent from our own address, so it's matched
  // before the own-message check. No AI answer for it.
  const testToken = org.onboarding.testToken;
  if (testToken && (mail.subject ?? "").includes(`[${testToken}]`)) {
    const ticket = await createTicket({
      orgId: org.id,
      channel: "email",
      customerEmail: sender.email,
      customerName: "Flatdesk test",
      subject: mail.subject.trim(),
      body: stripQuoted(mail.text) || "(empty message)",
      authorType: "customer",
      tags: [TEST_TAG],
      emailMessageId: mail.messageId,
    });
    await storeFiles(mail, org.id, ticket.id, ticket.messageId);
    await updateOnboarding(org.id, (ob) => ({ ...ob, testToken: undefined }));
    return { ticket: ticket.number, action: "created" };
  }

  if (isAutoReply(mail.headers)) return { ignored: "auto-reply" };
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
      const messageId = await addCustomerMessage({ orgId: org.id, ticketId, customerId: customer.id, body, emailMessageId: mail.messageId }).catch(duplicate);
      if (!messageId) return { ignored: "duplicate" };
      await storeFiles(mail, org.id, ticketId, messageId);
      // The route runs the AI next, which answers a follow-up or hands the ticket back.
      return { ticket: ticket.number, action: "appended", orgId: org.id, ticketId };
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
  }).catch(duplicate);
  if (!ticket) return { ignored: "duplicate" };
  await storeFiles(mail, org.id, ticket.id, ticket.messageId);
  return { ticket: ticket.number, action: "created", orgId: org.id, ticketId: ticket.id };
}
