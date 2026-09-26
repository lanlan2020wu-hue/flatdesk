import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { Resend } from "resend";
import { db, schema } from "@/db";

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

// Pulls the bare address out of `"Name" <a@b.co>`.
export function parseAddress(raw: string): { email: string; name: string | null } {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { email: m[2].trim().toLowerCase(), name: m[1].trim() || null };
  return { email: raw.trim().toLowerCase(), name: null };
}

// Finds our org key (and ticket number, if the customer replied to one of our
// emails) among the recipients.
export function matchRecipient(addresses: string[]): { key: string; number: number | null } | null {
  const domain = emailConfig.inboundDomain;
  if (!domain) return null;
  for (const raw of addresses) {
    const { email } = parseAddress(raw);
    const [local, host] = email.split("@");
    if (host !== domain || !local) continue;
    const [key, num] = local.split("+");
    const n = Number(num);
    return { key, number: num && Number.isInteger(n) && n > 0 ? n : null };
  }
  return null;
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

export function isAutoReply(headers: Record<string, string> | null): boolean {
  if (!headers) return false;
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));
  if (h["auto-submitted"] && h["auto-submitted"] !== "no") return true;
  if (["bulk", "junk", "list", "auto_reply"].includes(h["precedence"] ?? "")) return true;
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
  const headers: Record<string, string> = { "Message-ID": ownId };
  if (refs.length) {
    headers["In-Reply-To"] = refs[refs.length - 1];
    headers["References"] = refs.slice(-10).join(" ");
  }

  const subject = /^re:/i.test(row.ticket.subject) ? row.ticket.subject : `Re: ${row.ticket.subject}`;
  const { error } = await resend().emails.send({
    from: `${row.org.name} <${emailConfig.from}>`,
    to: row.customer.email,
    replyTo: replyToAddress(row.org.inboundKey, row.ticket.number) ?? undefined,
    subject,
    text: row.message.body,
    headers,
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
