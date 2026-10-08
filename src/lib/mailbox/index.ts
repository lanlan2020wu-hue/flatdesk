import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { keepInbound } from "@/lib/attachments";
import { cleanSenderName, htmlToText } from "@/lib/email";
import { seal, unseal } from "@/lib/import/crypto";
import { handleMailboxEmail, type InboundResult } from "@/lib/inbound";
import {
  exchangeGmailCode,
  freshTokens,
  getGmailMessage,
  gmailAttachment,
  gmailProfile,
  GmailError,
  newInboxMessages,
  readGmailMessage,
  revokeGmail,
  sendGmail,
  type GmailTokens,
} from "./gmail";
import { addressHeader, buildMime, splitAddresses, type OutgoingMail } from "./mime";

// A team's own mailbox, connected by signing in (Gmail for now). New mail in
// its inbox becomes tickets, read every couple of minutes by the cron, and
// replies are sent from it. Forwarding to the Flatdesk address keeps working
// alongside; the same email arriving both ways becomes one message.

const { integrations, orgs } = schema;
type Row = typeof integrations.$inferSelect;

const PER_RUN = 25; // messages per mailbox per run

export async function mailboxFor(orgId: string): Promise<Row | null> {
  const [row] = await db.select().from(integrations).where(and(eq(integrations.orgId, orgId), eq(integrations.kind, "gmail")));
  return row ?? null;
}

async function tokensFor(row: Row, fetcher: typeof fetch): Promise<GmailTokens> {
  const { tokens, changed } = await freshTokens(unseal(row.credentials) as GmailTokens, fetcher);
  if (changed) await db.update(integrations).set({ credentials: seal(tokens) }).where(eq(integrations.id, row.id));
  return tokens;
}

async function noteError(row: Row, error: string | null) {
  if (error === row.lastError) return;
  await db.update(integrations).set({ lastError: error, lastErrorAt: error ? new Date() : null }).where(eq(integrations.id, row.id));
}

// After Google sends the admin back: saves the mailbox, starting from now so
// old mail doesn't flood the inbox.
export async function connectGmail(orgId: string, userId: string, code: string, fetcher: typeof fetch = fetch): Promise<{ address: string }> {
  const tokens = await exchangeGmailCode(code, fetcher);
  const profile = await gmailProfile(tokens.access, fetcher);
  const address = profile.emailAddress.toLowerCase();
  const values = { account: address, credentials: seal(tokens), connectedBy: userId, lastError: null, lastErrorAt: null, settings: { mailbox: address, historyId: profile.historyId } };
  await db
    .insert(integrations)
    .values({ orgId, kind: "gmail", ...values })
    .onConflictDoUpdate({ target: [integrations.orgId, integrations.kind], set: { ...values, createdAt: new Date() } });
  return { address };
}

export async function disconnectMailbox(orgId: string, fetcher: typeof fetch = fetch) {
  const row = await mailboxFor(orgId);
  if (!row) return;
  await revokeGmail(unseal(row.credentials) as GmailTokens, fetcher);
  await db.delete(integrations).where(eq(integrations.id, row.id));
}

// ---- Reading ------------------------------------------------------------------------

export type PolledTicket = { orgId: string; ticketId: string; action?: InboundResult["action"]; unverified?: boolean };

// One mailbox: new inbox messages since last time, each handled like an email
// sent to the team's Flatdesk address.
export async function pollMailbox(row: Row, fetcher: typeof fetch = fetch): Promise<PolledTicket[]> {
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, row.orgId), columns: { inboundKey: true } });
  const mailbox = row.settings.mailbox;
  if (!org || !mailbox) return [];
  const out: PolledTicket[] = [];
  try {
    const tokens = await tokensFor(row, fetcher);
    let historyId = row.settings.historyId;
    if (!historyId) historyId = (await gmailProfile(tokens.access, fetcher)).historyId;
    const found = await newInboxMessages(tokens.access, historyId, fetcher, PER_RUN);
    for (const id of found.ids) {
      const m = readGmailMessage(await getGmailMessage(tokens.access, id, fetcher));
      const result = await handleMailboxEmail(
        {
          from: m.header("From") ?? "",
          to: [...splitAddresses(m.header("To")), ...splitAddresses(m.header("Cc"))],
          subject: m.header("Subject") ?? "",
          text: m.text || (m.html ? htmlToText(m.html) : ""),
          headers: m.headers,
          messageId: m.header("Message-ID")?.trim() ?? null,
          copied: [...splitAddresses(m.header("To")), ...splitAddresses(m.header("Cc"))],
          mailbox,
          attachments: () => keepInbound(m.files, async (i) => (m.files[i].data ? Buffer.from(m.files[i].data!, "base64url") : gmailAttachment(tokens.access, id, m.files[i].attachmentId!, fetcher))),
        },
        org.inboundKey,
      );
      if (result.orgId && result.ticketId) out.push({ orgId: result.orgId, ticketId: result.ticketId, action: result.action, unverified: result.unverified });
    }
    // Next time starts after what was handled (or, when stopped early, at the record it stopped in).
    await db
      .update(integrations)
      .set({ settings: { ...row.settings, historyId: found.historyId } })
      .where(eq(integrations.id, row.id));
    await noteError(row, found.expired ? "Some mail from while Flatdesk couldn't read this mailbox may have been missed. Check its inbox." : null);
  } catch (err) {
    const message = err instanceof GmailError ? err.message : "Gmail couldn't be reached. Flatdesk tries again in a few minutes.";
    if (!(err instanceof GmailError)) console.error("gmail poll failed", row.orgId, err);
    await noteError(row, message);
  }
  return out;
}

export async function pollMailboxes(fetcher: typeof fetch = fetch): Promise<PolledTicket[]> {
  const rows = await db.select().from(integrations).where(eq(integrations.kind, "gmail"));
  const out: PolledTicket[] = [];
  for (const row of rows) out.push(...(await pollMailbox(row, fetcher)));
  return out;
}

// ---- Sending ------------------------------------------------------------------------

// Sends a reply from the team's mailbox. Returns the Message-ID to thread on,
// or the error to show on the message.
export async function sendFromMailbox(row: Row, mail: Omit<OutgoingMail, "from"> & { fromName: string }, fetcher: typeof fetch = fetch): Promise<{ messageId: string | null } | { error: string }> {
  const mailbox = row.settings.mailbox;
  if (!mailbox) return { error: "The connected mailbox has no address. Connect it again." };
  try {
    const tokens = await tokensFor(row, fetcher);
    const raw = buildMime({ ...mail, from: addressHeader(cleanSenderName(mail.fromName) || null, mailbox) });
    const sent = await sendGmail(tokens.access, raw, fetcher);
    if (row.lastError) await noteError(row, null);
    return { messageId: sent.messageId };
  } catch (err) {
    const message = err instanceof GmailError ? err.message : "Gmail couldn't be reached.";
    if (!(err instanceof GmailError)) console.error("gmail send failed", row.orgId, err);
    await noteError(row, message);
    return { error: message };
  }
}
