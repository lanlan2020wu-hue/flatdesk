import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { Resend } from "resend";
import { db, schema } from "@/db";
import { emailAttachments } from "@/lib/attachments";
import { csatText, replyHtml } from "@/lib/csat";
import { parseTicketNumber } from "@/lib/tickets";

// Email runs through Resend. Inbound mail for every org arrives at
// <inboundKey>@INBOUND_DOMAIN; replies go out from EMAIL_FROM with a
// Reply-To of <inboundKey>+<ticketNumber>@INBOUND_DOMAIN so answers thread.

export const emailConfig = {
  apiKey: process.env.RESEND_API_KEY,
  inboundDomain: process.env.INBOUND_DOMAIN?.toLowerCase(),
  from: process.env.EMAIL_FROM, // e.g. support@mail.flatdesk.app
  webhookSecret: process.env.RESEND_WEBHOOK_SECRET,
};

let client: Resend | null = null;
export function resend(): Resend {
  if (!emailConfig.apiKey) throw new Error("RESEND_API_KEY is not set.");
  client ??= new Resend(emailConfig.apiKey);
  return client;
}

export function inboundAddress(inboundKey: string) {
  return emailConfig.inboundDomain ? `${inboundKey}@${emailConfig.inboundDomain}` : null;
}

export function replyToAddress(inboundKey: string, ticketNumber: number) {
  return emailConfig.inboundDomain ? `${inboundKey}+${ticketNumber}@${emailConfig.inboundDomain}` : null;
}

// The team's name as the From display name. Team names are typed by anyone, so
// they're quoted, and characters that could end the quote, start a second
// address or a new header line are dropped: "Acme, Inc" stays one sender, and
// a team can't name itself "Bank <alerts@bank.com>" to look like someone else.
export function fromAddress(teamName: string, address: string) {
  const name = teamName.replace(/[\x00-\x1f\x7f"\\<>@]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60).trim();
  return name ? `"${name}" <${address}>` : address;
}

// Pulls the bare address out of `"Name" <a@b.co>`, `a@b.co (Name)` or a bare
// address. Anything else gives an empty email rather than storing the whole
// header as one, which would make a second customer for the same person.
export function parseAddress(raw: string): { email: string; name: string | null } {
  const ADDR = /[^\s<>"(),;:@]+@[^\s<>"(),;:@]+\.[^\s<>"(),;:@]+/;
  const angle = /<([^<>]*)>\s*$/.exec(raw);
  if (angle && ADDR.test(angle[1])) {
    const name = raw.slice(0, angle.index).trim().replace(/^"|"$/g, "").trim();
    return { email: ADDR.exec(angle[1])![0].toLowerCase(), name: name || null };
  }
  const bare = ADDR.exec(raw);
  if (!bare) return { email: "", name: null };
  const comment = /\(([^()]*)\)/.exec(raw.slice(bare.index + bare[0].length));
  return { email: bare[0].toLowerCase(), name: comment?.[1].trim() || null };
}

// Whether the receiving server vouched for the From address. Only an explicit
// DMARC failure counts against it: forwarding (how most teams connect) often
// breaks SPF, and many senders publish no DMARC policy at all.
export function senderCheck(headers: Record<string, string> | null): "fail" | "ok" {
  if (!headers) return "ok";
  const results = Object.entries(headers)
    .filter(([k]) => k.toLowerCase() === "authentication-results" || k.toLowerCase() === "arc-authentication-results")
    .map(([, v]) => String(v).toLowerCase());
  return results.some((r) => /\bdmarc=fail\b/.test(r)) ? "fail" : "ok";
}

// Finds our org key (and ticket number, if the customer replied to one of our
// emails) among the recipients.
export function matchRecipient(addresses: string[]): { key: string; number: number | null } | null {
  return matchRecipients(addresses)[0] ?? null;
}

// Every org the email is addressed to, once each, in the order given. Callers
// list the envelope recipients first: a header To can name another team's
// address (a reply-all) when this copy was really delivered for this team.
export function matchRecipients(addresses: string[]): { key: string; number: number | null }[] {
  const domain = emailConfig.inboundDomain;
  if (!domain) return [];
  const out: { key: string; number: number | null }[] = [];
  for (const raw of addresses) {
    const { email } = parseAddress(raw);
    const [local, host] = email.split("@");
    if (host !== domain || !local) continue;
    const [key, num] = local.split("+");
    if (key && !out.some((t) => t.key === key)) out.push({ key, number: parseTicketNumber(num) });
  }
  return out;
}

// Keeps only the new part of a reply: drops quoted lines and everything from
// the usual "On <date>, <name> wrote:" marker down.
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const joined = line + " " + (lines[i + 1] ?? "");
    if (/^On .+wrote:\s*$/.test(line) || /^On .+wrote:\s*$/.test(joined.trim())) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line)) break;
    if (/^From: .+/.test(line) && /^(Sent|Date): /.test(lines[i + 1] ?? "")) break;
    if (line.startsWith(">")) continue;
    out.push(line);
  }
  const result = out.join("\n").trim();
  return result || text.trim();
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/h\d)\s*\/?>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isAutoReply(headers: Record<string, string> | null, mail?: { from?: string; subject?: string }): boolean {
  // Bounces and out-of-office replies that don't say so in their headers.
  if (mail?.from && /^(mailer-daemon|postmaster)@/i.test(parseAddress(mail.from).email)) return true;
  if (mail?.subject && /^\s*(automatic reply|auto(matic)?[- ]?reply|out of (the )?office|undeliverable|delivery status notification)\b/i.test(mail.subject)) return true;
  if (!headers) return false;
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));
  if (h["auto-submitted"] && h["auto-submitted"] !== "no") return true;
  if (["bulk", "junk", "list", "auto_reply"].includes(h["precedence"] ?? "")) return true;
  if ((h["content-type"] ?? "").startsWith("multipart/report")) return true;
  return Boolean(h["x-autoreply"] || h["x-autorespond"] || h["list-id"]);
}

// Sends one agent reply to the customer and records the result on the message.
// A failed send never loses the reply: it stays in the ticket with an error.
export async function deliverReply(orgId: string, messageId: string): Promise<void> {
  if (!emailConfig.apiKey || !emailConfig.from) return; // email not configured (local dev)

  const [row] = await db
    .select({ message: schema.messages, ticket: schema.tickets, customer: schema.customers, org: schema.orgs })
    .from(schema.messages)
    .innerJoin(schema.tickets, eq(schema.tickets.id, schema.messages.ticketId))
    .innerJoin(schema.customers, eq(schema.customers.id, schema.tickets.customerId))
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.messages.orgId))
    .where(and(eq(schema.messages.orgId, orgId), eq(schema.messages.id, messageId)));
  // Chat replies are emailed too, so a visitor who closed the tab still gets them.
  if (!row || row.message.internal) return;

  // Thread onto the conversation the customer already has.
  const earlier = await db
    .select({ id: schema.messages.emailMessageId })
    .from(schema.messages)
    .where(and(eq(schema.messages.ticketId, row.ticket.id), isNotNull(schema.messages.emailMessageId)))
    .orderBy(asc(schema.messages.createdAt));
  const refs = earlier.map((e) => e.id!).filter((id) => id !== row.message.emailMessageId);

  const fromDomain = emailConfig.from.split("@")[1];
  const ownId = `<${row.message.id}@${fromDomain}>`;
  // X-Flatdesk-Org lets another Flatdesk team's inbox tell our mail from its own.
  // AI answers say they're automatic (RFC 3834), so a well-behaved autoresponder
  // stays quiet and two help desks can't answer each other forever.
  const headers: Record<string, string> = { "Message-ID": ownId, "X-Flatdesk-Org": orgId };
  if (row.message.authorType === "ai") headers["Auto-Submitted"] = "auto-replied";
  if (refs.length) {
    headers["In-Reply-To"] = refs[refs.length - 1];
    headers["References"] = refs.slice(-10).join(" ");
  }

  const rateable = row.org.csatEnabled && (row.message.authorType === "agent" || row.message.authorType === "ai");
  // A chat visitor types any email address and the first line becomes the
  // subject, so chat emails get a fixed subject and say where they came from:
  // the team's name can't be used to send someone else's words to a stranger.
  const chat = row.ticket.channel === "chat";
  const subject = chat
    ? `Your chat with ${row.org.name}`
    : /^re:/i.test(row.ticket.subject) ? row.ticket.subject : `Re: ${row.ticket.subject}`;
  const chatNote = chat ? `\n\n--\nYou're getting this because someone started a chat with ${row.org.name} using this email address. If that wasn't you, you can ignore it.` : "";
  const { error } = await resend().emails.send({
    from: fromAddress(row.org.name, emailConfig.from),
    to: row.customer.email,
    replyTo: replyToAddress(row.org.inboundKey, row.ticket.number) ?? undefined,
    subject,
    // Agent and AI replies end with one-click rating links unless the team turned them off.
    text: (rateable ? row.message.body + csatText(row.message.id) : row.message.body) + chatNote,
    html: replyHtml(row.message.body + chatNote, rateable ? row.message.id : null),
    headers,
    attachments: await emailAttachments(row.message.id),
  });

  await db
    .update(schema.messages)
    .set(error ? { deliveryError: error.message.slice(0, 300) } : { emailMessageId: ownId, deliveryError: null })
    .where(eq(schema.messages.id, row.message.id));
}

// Looks up the ticket an inbound email belongs to via its In-Reply-To and
// References headers, for mail clients that drop our plus-addressed Reply-To.
export async function ticketFromHeaders(orgId: string, headers: Record<string, string> | null) {
  if (!headers) return null;
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const ids = `${lower["in-reply-to"] ?? ""} ${lower["references"] ?? ""}`.match(/<[^>]+>/g) ?? [];
  if (ids.length === 0) return null;
  const [hit] = await db
    .select({ ticketId: schema.messages.ticketId })
    .from(schema.messages)
    .where(and(eq(schema.messages.orgId, orgId), inArray(schema.messages.emailMessageId, ids)))
    .orderBy(desc(schema.messages.createdAt))
    .limit(1);
  return hit?.ticketId ?? null;
}
