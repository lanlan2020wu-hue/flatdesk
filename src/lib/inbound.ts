import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { emailConfig, isAutoReply, matchRecipients, parseAddress, senderCheck, stripQuoted, ticketFromHeaders } from "@/lib/email";
import { milestone } from "@/lib/funnel";
import { TEST_TAG, updateOnboarding } from "@/lib/onboarding";
import { saveAttachments, type NewFile } from "@/lib/attachments";
import { ccFromEmail, mergeCc } from "@/lib/cc";
import { resolveMerged } from "@/lib/merge";
import { addCustomerMessage, addSystemNote, createTicket, NO_AI_SETUP_NOTE } from "@/lib/tickets";

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
  // Everyone in To and Cc, for copying them on replies (lib/cc.ts).
  copied?: string[];
  // Fetches the email's files; only called once the email is known to become a message.
  attachments?: () => Promise<{ files: NewFile[]; skipped: string[] }>;
  // Read from the team's connected mailbox (lib/mailbox/), this address.
  mailbox?: string;
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

export type InboundResult = {
  ignored?: string;
  ticket?: number;
  action?: "created" | "appended";
  orgId?: string;
  ticketId?: string;
  unverified?: boolean; // the From address failed DMARC: no AI answer
};

// One email can be for several teams (it was sent to each of their support
// addresses). Each team gets its own copy; the first result is returned.
export async function handleInboundEmail(mail: Inbound): Promise<InboundResult> {
  return (await handleInboundEmailAll(mail))[0];
}

export async function handleInboundEmailAll(mail: Inbound): Promise<InboundResult[]> {
  const targets = matchRecipients(mail.to);
  if (!targets.length) return [{ ignored: "no matching inbox" }];
  const results: InboundResult[] = [];
  for (const target of targets) results.push(await handleFor(mail, target));
  return results;
}

// Mail read from a team's own connected mailbox: it's for that team whatever the To says.
export function handleMailboxEmail(mail: Inbound & { mailbox: string }, inboundKey: string): Promise<InboundResult> {
  return handleFor(mail, { key: inboundKey, number: null });
}

async function handleFor(mail: Inbound, target: { key: string; number: number | null }): Promise<InboundResult> {
  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.inboundKey, target.key) });
  if (!org) return { ignored: "unknown inbox" };

  const sender = parseAddress(mail.from);
  if (!sender.email) return { ignored: "no sender address" };
  // Anyone can put any address in From. When the receiving server says it
  // failed DMARC, the email still becomes a ticket, but it can't join an
  // existing customer's ticket, change onboarding or get an AI answer.
  const unverified = senderCheck(mail.headers) === "fail";

  // Gmail asks the forwarding address to confirm before it forwards anything.
  // Show the code in onboarding instead of opening a ticket for it.
  if (sender.email === "forwarding-noreply@google.com" && !unverified) {
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
      // Replies go to the admin who sent the test, not to Flatdesk's own address.
      customerEmail: org.onboarding.testReplyTo ?? sender.email,
      customerName: "Flatdesk test",
      subject: mail.subject.trim(),
      body: stripQuoted(mail.text) || "(empty message)",
      authorType: "customer",
      tags: [TEST_TAG],
      emailMessageId: mail.messageId,
    });
    await storeFiles(mail, org.id, ticket.id, ticket.messageId);
    await addSystemNote(org.id, ticket.id, NO_AI_SETUP_NOTE);
    await updateOnboarding(org.id, (ob) => ({ ...ob, testToken: undefined }));
    await milestone(org.id, "channel_connected", { channel: "email" });
    return { ticket: ticket.number, action: "created" };
  }

  if (isAutoReply(mail.headers, mail)) return { ignored: "auto-reply" };
  // Teams send from the shared address, or their own (orgs.sendAddress). Mail
  // from either is our own unless it says it came from another team
  // (X-Flatdesk-Org), which is a person at another Flatdesk team writing to this one.
  if ((emailConfig.from && sender.email === emailConfig.from.toLowerCase()) || (org.sendAddress && sender.email === org.sendAddress) || (mail.mailbox && sender.email === mail.mailbox)) {
    const fromOrg = Object.entries(mail.headers ?? {}).find(([k]) => k.toLowerCase() === "x-flatdesk-org")?.[1];
    if (!fromOrg || fromOrg === org.id) return { ignored: "own message" };
  }

  // Resend retries deliveries; the Message-ID makes processing idempotent.
  if (mail.messageId) {
    const seen = await db.query.messages.findFirst({
      where: and(eq(schema.messages.orgId, org.id), eq(schema.messages.emailMessageId, mail.messageId)),
    });
    if (seen) return { ignored: "duplicate" };
  }

  const body = stripQuoted(mail.text) || "(empty message)";

  let ticketId: string | null = null;
  if (target.number && !unverified) {
    const t = await db.query.tickets.findFirst({
      where: and(eq(schema.tickets.orgId, org.id), eq(schema.tickets.number, target.number)),
    });
    ticketId = t?.id ?? null;
  }
  if (!unverified) ticketId ??= await ticketFromHeaders(org.id, mail.headers);
  // A merged ticket's mail goes to the ticket it was merged into.
  if (ticketId) ticketId = await resolveMerged(org.id, ticketId);

  if (ticketId) {
    const ticket = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, ticketId) });
    const customer = ticket && (await db.query.customers.findFirst({ where: eq(schema.customers.id, ticket.customerId) }));
    // Only the ticket's own customer, or someone copied on it, can add to it;
    // anyone else starts a new ticket.
    const copied = Boolean(ticket?.cc.includes(sender.email));
    if (ticket && customer && (customer.email === sender.email || copied)) {
      const author = customer.email === sender.email ? customer : await customerFor(org.id, sender.email, sender.name);
      const messageId = await addCustomerMessage({ orgId: org.id, ticketId, customerId: author.id, body, emailMessageId: mail.messageId }).catch(duplicate);
      if (!messageId) return { ignored: "duplicate" };
      // A chat's email address is whatever the visitor typed. Once the mailbox
      // owner writes in, the conversation carries on by email only, so whoever
      // started the chat can't read their reply or the answers to it.
      if (ticket.channel === "chat" && ticket.visitorToken) {
        await db.update(schema.tickets).set({ visitorToken: null }).where(and(eq(schema.tickets.orgId, org.id), eq(schema.tickets.id, ticketId)));
      }
      await storeFiles(mail, org.id, ticketId, messageId);
      const cc = mergeCc(ticket.cc, ccFromEmail(mail.copied ?? [], { customer: sender.email, supportEmail: org.supportEmail ?? org.sendAddress, own: mail.mailbox }), customer.email);
      if (cc.join() !== ticket.cc.join()) await db.update(schema.tickets).set({ cc }).where(eq(schema.tickets.id, ticketId));
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
  // Mail that failed DMARC copies nobody: its sender may not be who they say.
  const cc = unverified ? [] : ccFromEmail(mail.copied ?? [], { customer: sender.email, supportEmail: org.supportEmail ?? org.sendAddress, own: mail.mailbox }).slice(0, 10);
  if (cc.length) await db.update(schema.tickets).set({ cc }).where(eq(schema.tickets.id, ticket.id));
  await storeFiles(mail, org.id, ticket.id, ticket.messageId);
  if (unverified) {
    await db.insert(schema.messages).values({
      orgId: org.id,
      ticketId: ticket.id,
      authorType: "system",
      internal: true,
      body: `The sender's email provider says this message may not really be from ${sender.email} (it failed DMARC). It wasn't added to an existing conversation and the AI didn't answer it. Check before acting on it.`,
    });
    return { ticket: ticket.number, action: "created", orgId: org.id, ticketId: ticket.id, unverified: true };
  }
  if (!org.onboarding.milestones?.first_customer_ticket) {
    await milestone(org.id, "channel_connected", { channel: "email" });
    await milestone(org.id, "first_customer_ticket", { channel: "email" });
  }
  return { ticket: ticket.number, action: "created", orgId: org.id, ticketId: ticket.id };
}

// The customer row for someone copied on a ticket who replied.
async function customerFor(orgId: string, email: string, name: string | null) {
  const [c] = await db
    .insert(schema.customers)
    .values({ orgId, email, name })
    .onConflictDoUpdate({ target: [schema.customers.orgId, schema.customers.email], set: { email } })
    .returning();
  return c;
}
