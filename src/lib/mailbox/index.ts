import { and, eq, inArray, ne } from "drizzle-orm";
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
import {
  exchangeMicrosoftCode,
  freshMicrosoftTokens,
  graphAttachments,
  MicrosoftError,
  microsoftProfile,
  newInboxMessagesGraph,
  recipientText,
  sendGraph,
  type GraphMessage,
} from "./microsoft";
import { addressHeader, buildMime, splitAddresses, type OutgoingMail } from "./mime";

// A team's own mailbox, connected by signing in (Gmail, or Outlook and
// Microsoft 365; one per team). New mail in
// its inbox becomes tickets, read every couple of minutes by the cron, and
// replies are sent from it. Forwarding to the Flatdesk address keeps working
// alongside; the same email arriving both ways becomes one message.

const { integrations, orgs } = schema;
type Row = typeof integrations.$inferSelect;

const PER_RUN = 25; // messages per mailbox per run
const KINDS = ["gmail", "microsoft"] as const;
export type MailboxKind = (typeof KINDS)[number];
export const MAILBOX_NAMES: Record<MailboxKind, string> = { gmail: "Gmail", microsoft: "Outlook" };

export async function mailboxFor(orgId: string): Promise<Row | null> {
  const [row] = await db.select().from(integrations).where(and(eq(integrations.orgId, orgId), inArray(integrations.kind, [...KINDS])));
  return row ?? null;
}

const isProviderError = (err: unknown): err is Error => err instanceof GmailError || err instanceof MicrosoftError;

async function tokensFor(row: Row, fetcher: typeof fetch): Promise<GmailTokens> {
  const saved = unseal(row.credentials) as GmailTokens;
  const { tokens, changed } = row.kind === "microsoft" ? await freshMicrosoftTokens(saved, fetcher) : await freshTokens(saved, fetcher);
  if (changed) await db.update(integrations).set({ credentials: seal(tokens) }).where(eq(integrations.id, row.id));
  return tokens;
}

// Saves a newly connected mailbox in place of any other the team had.
async function saveMailbox(orgId: string, kind: MailboxKind, userId: string, address: string, tokens: GmailTokens, settings: schema.IntegrationSettings) {
  const values = { account: address, credentials: seal(tokens), connectedBy: userId, lastError: null, lastErrorAt: null, settings: { mailbox: address, ...settings } };
  await db.transaction(async (tx) => {
    await tx.delete(integrations).where(and(eq(integrations.orgId, orgId), inArray(integrations.kind, [...KINDS]), ne(integrations.kind, kind)));
    await tx
      .insert(integrations)
      .values({ orgId, kind, ...values })
      .onConflictDoUpdate({ target: [integrations.orgId, integrations.kind], set: { ...values, createdAt: new Date() } });
  });
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
  await saveMailbox(orgId, "gmail", userId, address, tokens, { historyId: profile.historyId });
  return { address };
}

// The same for Microsoft, reading mail received from now on.
export async function connectMicrosoft(orgId: string, userId: string, code: string, fetcher: typeof fetch = fetch, now = new Date()): Promise<{ address: string }> {
  const tokens = await exchangeMicrosoftCode(code, fetcher);
  const { address } = await microsoftProfile(tokens.access, fetcher);
  await saveMailbox(orgId, "microsoft", userId, address, tokens, { since: now.toISOString() });
  return { address };
}

export async function disconnectMailbox(orgId: string, fetcher: typeof fetch = fetch) {
  const row = await mailboxFor(orgId);
  if (!row) return;
  // Microsoft has no revoke call for an app; the team removes it in their account if they want.
  if (row.kind === "gmail") await revokeGmail(unseal(row.credentials) as GmailTokens, fetcher);
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
  const keep = (result: InboundResult) => {
    if (result.orgId && result.ticketId) out.push({ orgId: result.orgId, ticketId: result.ticketId, action: result.action, unverified: result.unverified });
  };
  try {
    const tokens = await tokensFor(row, fetcher);
    if (row.kind === "microsoft") {
      await pollMicrosoft(row, tokens.access, mailbox, org.inboundKey, keep, fetcher);
      await noteError(row, null);
      return out;
    }
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
      keep(result);
    }
    // Next time starts after what was handled (or, when stopped early, at the record it stopped in).
    await db
      .update(integrations)
      .set({ settings: { ...row.settings, historyId: found.historyId } })
      .where(eq(integrations.id, row.id));
    await noteError(row, found.expired ? "Some mail from while Flatdesk couldn't read this mailbox may have been missed. Check its inbox." : null);
  } catch (err) {
    const message = isProviderError(err) ? err.message : `${MAILBOX_NAMES[row.kind as MailboxKind]} couldn't be reached. Flatdesk tries again in a few minutes.`;
    if (!isProviderError(err)) console.error("mailbox poll failed", row.orgId, err);
    await noteError(row, message);
  }
  return out;
}

// Graph has no history id for mail; Flatdesk asks for what arrived since the
// last message it saw (the same email twice is one message, by Message-ID).
async function pollMicrosoft(row: Row, access: string, mailbox: string, inboundKey: string, keep: (r: InboundResult) => void, fetcher: typeof fetch) {
  const since = row.settings.since ?? new Date().toISOString();
  const found: GraphMessage[] = await newInboxMessagesGraph(access, since, fetcher, PER_RUN);
  for (const m of found) {
    const headers = Object.fromEntries((m.internetMessageHeaders ?? []).map((h) => [h.name, h.value]));
    const to = [...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])].map(recipientText).filter(Boolean);
    const body = m.body?.content ?? "";
    keep(
      await handleMailboxEmail(
        {
          from: recipientText(m.from),
          to,
          subject: m.subject ?? "",
          text: m.body?.contentType === "html" ? htmlToText(body) : body,
          headers,
          messageId: m.internetMessageId ?? null,
          copied: to,
          mailbox,
          attachments: async () => {
            if (!m.hasAttachments) return { files: [], skipped: [] };
            const list = await graphAttachments(access, m.id, fetcher);
            return keepInbound(
              list.map((a) => ({ filename: a.name, size: a.size ?? 0, contentType: a.contentType ?? "application/octet-stream", inline: Boolean(a.isInline) })),
              async (i) => Buffer.from(list[i].contentBytes!, "base64"),
            );
          },
        },
        inboundKey,
      ),
    );
  }
  const last = found.at(-1)?.receivedDateTime;
  if (last && last !== row.settings.since) await db.update(integrations).set({ settings: { ...row.settings, since: last } }).where(eq(integrations.id, row.id));
}

export async function pollMailboxes(fetcher: typeof fetch = fetch): Promise<PolledTicket[]> {
  const rows = await db.select().from(integrations).where(inArray(integrations.kind, [...KINDS]));
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
    const sent =
      row.kind === "microsoft"
        ? await sendGraph(tokens.access, { to: mail.to, cc: mail.cc, subject: mail.subject, html: mail.html, inReplyTo: mail.headers?.["In-Reply-To"], headers: mail.headers, attachments: mail.attachments }, fetcher)
        : await sendGmail(tokens.access, buildMime({ ...mail, from: addressHeader(cleanSenderName(mail.fromName) || null, mailbox) }), fetcher);
    if (row.lastError) await noteError(row, null);
    return { messageId: sent.messageId };
  } catch (err) {
    const message = isProviderError(err) ? err.message : `${MAILBOX_NAMES[row.kind as MailboxKind]} couldn't be reached.`;
    if (!isProviderError(err)) console.error("mailbox send failed", row.orgId, err);
    await noteError(row, message);
    return { error: message };
  }
}
