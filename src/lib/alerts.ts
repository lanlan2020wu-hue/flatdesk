import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { SITE } from "@/lib/site";

// Alerts to Slack, Discord, Google Chat or any webhook when a ticket needs a
// person: a new ticket the AI didn't answer (it's off, paused or handed off),
// or a ticket the AI answered that went back to the team. With alertOn "all",
// every new ticket is posted, saying whether the AI answered it.
//
// Slack, Discord and Google Chat get the message format they expect. Anything
// else gets JSON (see AlertPayload), signed with the org's alert secret:
// X-Flatdesk-Signature: sha256=<hex HMAC of the raw body>.

export type AlertEvent = "ticket.created" | "ticket.handed_back" | "test";

export type AlertPayload = {
  event: AlertEvent;
  text: string; // one line for chat tools; what Slack shows
  needsTeam: boolean;
  reason: string | null;
  ticket: {
    number: number;
    subject: string;
    channel: string;
    status: string;
    url: string;
    customer: { name: string | null; email: string };
    assignee: string | null;
  } | null;
  sentAt: string;
};

const TIMEOUT_MS = 5000;

// Admins paste the URL, and the server posts to it, so it must be a public
// https address, never something on our own network.
export function checkWebhookUrl(raw: string): { url: string } | { error: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { error: "That doesn't look like a web address." };
  }
  if (u.protocol !== "https:") return { error: "The webhook address has to start with https://." };
  if (u.username || u.password) return { error: "Put credentials in the path or query, not before the host." };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(host) || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local") || !host.includes(".")) {
    return { error: "Use the public address your tool gave you, not an IP address or a local name." };
  }
  return { url: u.toString() };
}

// True for loopback, private, link-local, CGNAT and other non-public addresses.
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const h = ip.toLowerCase();
  return h === "::" || h === "::1" || h.startsWith("fc") || h.startsWith("fd") || /^fe[89ab]/.test(h) || h.startsWith("ff");
}

// A public name can still point at a private address, so check where it resolves.
// Tests post to a local server, so they switch this off.
async function resolvesPublic(url: string): Promise<boolean> {
  if (process.env.ALERTS_ALLOW_PRIVATE === "1") return true;
  const addrs = await lookup(new URL(url).hostname, { all: true }).catch(() => []);
  return addrs.length > 0 && addrs.every((a) => !isPrivateAddress(a.address));
}

type Kind = "slack" | "discord" | "google-chat" | "generic";
export function webhookKind(url: string): Kind {
  const u = new URL(url);
  if (u.hostname === "hooks.slack.com") return "slack";
  if (/(^|\.)discord(app)?\.com$/.test(u.hostname) && u.pathname.startsWith("/api/webhooks/")) return "discord";
  if (u.hostname === "chat.googleapis.com") return "google-chat";
  return "generic";
}

export function webhookLabel(url: string): string {
  return { slack: "Slack", discord: "Discord", "google-chat": "Google Chat", generic: "Webhook" }[webhookKind(url)];
}

export function sign(secret: string, body: string) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

// The request for one alert, in the shape the receiving tool wants.
export function buildRequest(url: string, secret: string, p: AlertPayload): { body: string; headers: Record<string, string> } {
  const kind = webhookKind(url);
  const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "Flatdesk-Alerts/1" };
  if (kind === "slack") {
    // Slack's own link syntax; <, > and & must be escaped in the rest.
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const t = p.ticket;
    const ref = esc(t ? `#${t.number} ${t.subject}` : "");
    const text = t ? esc(p.text).replace(ref, () => `<${t.url}|${ref.replace(/\|/g, "¦")}>`) : esc(p.text);
    return { body: JSON.stringify({ text, unfurl_links: false }), headers };
  }
  if (kind === "discord") return { body: JSON.stringify({ content: p.text.slice(0, 1900) + (p.ticket ? `\n${p.ticket.url}` : ""), allowed_mentions: { parse: [] } }), headers };
  if (kind === "google-chat") return { body: JSON.stringify({ text: p.text + (p.ticket ? `\n${p.ticket.url}` : "") }), headers };
  const body = JSON.stringify(p);
  return { body, headers: { ...headers, "x-flatdesk-event": p.event, "x-flatdesk-signature": sign(secret, body) } };
}

export function alertText(event: AlertEvent, t: NonNullable<AlertPayload["ticket"]>, needsTeam: boolean, reason: string | null): string {
  const who = t.customer.name ? `${t.customer.name} (${t.customer.email})` : t.customer.email;
  const ref = `#${t.number} ${t.subject}`;
  if (event === "ticket.handed_back") return `Back with the team: ${ref} from ${who}.${reason ? ` ${reason}` : ""}`;
  const head = needsTeam ? `New ticket for the team: ${ref} from ${who} by ${t.channel}.` : `New ticket answered by the AI: ${ref} from ${who} by ${t.channel}.`;
  return reason && needsTeam ? `${head} ${reason}` : head;
}

type Org = typeof schema.orgs.$inferSelect;

// Posts one alert and records how it went on the org, for the settings page.
// Never throws: an alert that fails must not break the ticket flow.
export async function deliver(org: Pick<Org, "id" | "alertWebhookUrl" | "alertSecret">, payload: AlertPayload): Promise<string | null> {
  if (!org.alertWebhookUrl) return null;
  let error: string | null = null;
  try {
    if (!(await resolvesPublic(org.alertWebhookUrl))) throw new Error("The address doesn't resolve to a public server.");
    const { body, headers } = buildRequest(org.alertWebhookUrl, org.alertSecret, payload);
    // No redirects: a redirect could point the request somewhere the URL check never saw.
    const res = await fetch(org.alertWebhookUrl, { method: "POST", body, headers, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    // Only the status: the response body could be anything the server chose to send.
    if (!res.ok) error = `${res.status} ${res.statusText}`.trim();
  } catch (err) {
    error = err instanceof Error && err.name === "TimeoutError" ? "No answer within 5 seconds." : err instanceof Error ? err.message : "Couldn't reach the address.";
  }
  await db
    .update(schema.orgs)
    .set({ alertLastAt: new Date(), alertLastError: error?.slice(0, 300) ?? null })
    .where(eq(schema.orgs.id, org.id))
    .catch((err) => console.error("recording alert result failed", err));
  if (error) console.error("alert failed", org.id, error);
  return error;
}

async function ticketPayload(orgId: string, ticketId: string) {
  const [row] = await db
    .select({ ticket: schema.tickets, customer: schema.customers, assignee: schema.agents.name })
    .from(schema.tickets)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.tickets.customerId))
    .leftJoin(schema.agents, and(eq(schema.agents.orgId, schema.tickets.orgId), eq(schema.agents.userId, schema.tickets.assigneeId)))
    .where(and(eq(schema.tickets.orgId, orgId), eq(schema.tickets.id, ticketId)));
  if (!row) return null;
  const { ticket, customer } = row;
  return {
    ticket,
    payload: {
      number: ticket.number,
      subject: ticket.subject,
      channel: ticket.channel,
      status: ticket.status,
      url: `${SITE.url}/app/tickets/${ticket.number}`,
      customer: { name: customer.name, email: customer.email },
      assignee: row.assignee ?? null,
    },
  };
}

// The newest note Flatdesk left on the ticket, which says why the AI didn't answer.
async function latestNote(ticketId: string) {
  const [n] = await db
    .select({ body: schema.messages.body })
    .from(schema.messages)
    .where(and(eq(schema.messages.ticketId, ticketId), eq(schema.messages.authorType, "system")))
    .orderBy(desc(schema.messages.createdAt))
    .limit(1);
  return n?.body ?? null;
}

// Called once the AI has had its turn on a new ticket.
export async function alertNewTicket(orgId: string, ticketId: string) {
  try {
    const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, orgId) });
    if (!org?.alertWebhookUrl) return;
    const found = await ticketPayload(orgId, ticketId);
    if (!found) return;
    const needsTeam = !found.ticket.resolvedByAi && found.ticket.status === "open";
    if (!needsTeam && org.alertOn !== "all") return;
    const note = needsTeam ? await latestNote(ticketId) : null;
    const reason = note && !note.startsWith("AI answered") ? note : null;
    await deliver(org, {
      event: "ticket.created",
      text: alertText("ticket.created", found.payload, needsTeam, reason),
      needsTeam,
      reason,
      ticket: found.payload,
      sentAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("new ticket alert failed", err);
  }
}

// A ticket the AI answered is now the team's (the customer wrote back, asked
// for a person, or rated the answer badly).
export async function alertHandedBack(orgId: string, ticketId: string, reason: string | null) {
  try {
    const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, orgId) });
    if (!org?.alertWebhookUrl) return;
    const found = await ticketPayload(orgId, ticketId);
    if (!found) return;
    await deliver(org, {
      event: "ticket.handed_back",
      text: alertText("ticket.handed_back", found.payload, true, reason),
      needsTeam: true,
      reason,
      ticket: found.payload,
      sentAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("hand-back alert failed", err);
  }
}

export async function sendTestAlert(org: Pick<Org, "id" | "name" | "alertWebhookUrl" | "alertSecret">) {
  return deliver(org, {
    event: "test",
    text: `Flatdesk alerts are connected for ${org.name}. New tickets that need your team will show up here.`,
    needsTeam: false,
    reason: null,
    ticket: null,
    sentAt: new Date().toISOString(),
  });
}
