import { createHmac } from "node:crypto";
import { lookup, type LookupAddress } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
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
    test?: boolean; // made from /app/test-tickets
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

// True for loopback, private, link-local, CGNAT and other non-public
// addresses, including IPv4 addresses carried inside IPv6 (mapped, NAT64,
// 6to4), which reach the same private network.
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return privateV4(ip.split(".").map(Number));
  if (kind !== 6) return true; // not an address at all: never treat it as public
  const h = v6Hextets(ip);
  if (!h) return true;
  const v4At = (i: number) => [h[i] >> 8, h[i] & 255, h[i + 1] >> 8, h[i + 1] & 255];
  const zero = (from: number, to: number) => h.slice(from, to).every((x) => x === 0);
  if (zero(0, 8) || (zero(0, 7) && h[7] === 1)) return true; // :: and ::1
  if (zero(0, 5) && h[5] === 0xffff) return privateV4(v4At(6)); // ::ffff:a.b.c.d, IPv4-mapped
  if (zero(0, 6)) return true; // ::a.b.c.d, the old IPv4-compatible form
  if (h[0] === 0x64 && h[1] === 0xff9b && zero(2, 6)) return privateV4(v4At(6)); // 64:ff9b::/96, NAT64
  if (h[0] === 0x64 && h[1] === 0xff9b) return true; // 64:ff9b:1::/48, local NAT64
  if (h[0] === 0x2002) return privateV4(v4At(1)); // 2002::/16, 6to4
  if (h[0] === 0x2001 && h[1] === 0) return true; // 2001::/32, Teredo tunnels
  if (h[0] === 0x2001 && h[1] === 0xdb8) return true; // documentation
  if (h[0] === 0x100 && zero(1, 4)) return true; // 100::/64, discard
  return (h[0] & 0xfe00) === 0xfc00 || (h[0] & 0xffc0) === 0xfe80 || (h[0] & 0xffc0) === 0xfec0 || (h[0] & 0xff00) === 0xff00;
}

function privateV4([a, b, c]: number[]): boolean {
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

// An IPv6 address as its eight 16-bit groups, with "::" and a dotted IPv4 tail expanded.
function v6Hextets(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    const [a, b, c, d] = dotted[1].split(".").map(Number);
    s = s.slice(0, -dotted[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = s.split("::");
  const part = (x: string | undefined) => (x ? x.split(":").map((g) => parseInt(g, 16)) : []);
  const left = part(head);
  const right = part(tail);
  const fill = tail === undefined ? 0 : 8 - left.length - right.length;
  const out = [...left, ...Array(Math.max(0, fill)).fill(0), ...right];
  return out.length === 8 && out.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? out : null;
}

// Tests post to a local server, so they switch the address checks off.
const allowPrivate = () => process.env.ALERTS_ALLOW_PRIVATE === "1";
const NOT_PUBLIC = "The address doesn't resolve to a public server.";

// DNS lookup for the alert request itself. Checking a name and then letting
// fetch resolve it again would let the name change in between (DNS
// rebinding), so the socket connects to exactly the addresses checked here.
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true, family: options.family ?? 0 }, (err, addrs: LookupAddress[]) => {
    if (err) return callback(err, "", 0);
    if (!addrs.length || (!allowPrivate() && addrs.some((a) => isPrivateAddress(a.address)))) {
      return callback(Object.assign(new Error(NOT_PUBLIC), { code: "ENOTPUBLIC" }), "", 0);
    }
    if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addrs);
    callback(null, addrs[0].address, addrs[0].family);
  });
};

// Posts the alert. No redirects are followed: a redirect could point the
// request somewhere the address check never saw.
export function postAlert(url: string, body: string, headers: Record<string, string>): Promise<{ status: number; statusText: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (u.protocol !== "https:" && !(allowPrivate() && u.protocol === "http:")) return reject(new Error("The webhook address has to start with https://."));
    // A literal IP never goes through lookup, so it's checked here.
    if (isIP(host) && !allowPrivate() && isPrivateAddress(host)) return reject(new Error(NOT_PUBLIC));
    const send = u.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(
      u,
      { method: "POST", headers: { ...headers, "content-length": String(Buffer.byteLength(body)) }, lookup: publicLookup, agent: false },
      (res) => {
        res.resume(); // only the status matters; the body could be anything
        clearTimeout(timer);
        resolve({ status: res.statusCode ?? 0, statusText: res.statusMessage ?? "" });
      },
    );
    const timer = setTimeout(() => req.destroy(Object.assign(new Error("timeout"), { name: "TimeoutError" })), TIMEOUT_MS);
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.end(body);
  });
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
  // Google Chat reads <users/all> as an @-mention, and the text carries what a customer typed.
  if (kind === "google-chat") return { body: JSON.stringify({ text: p.text.replace(/</g, "‹").replace(/>/g, "›") + (p.ticket ? `\n${p.ticket.url}` : "") }), headers };
  const body = JSON.stringify(p);
  return { body, headers: { ...headers, "x-flatdesk-event": p.event, "x-flatdesk-signature": sign(secret, body) } };
}

export function alertText(event: AlertEvent, t: NonNullable<AlertPayload["ticket"]>, needsTeam: boolean, reason: string | null): string {
  const who = t.customer.name ? `${t.customer.name} (${t.customer.email})` : t.customer.email;
  const ref = `${t.test ? "test ticket " : ""}#${t.number} ${t.subject}`;
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
    const { body, headers } = buildRequest(org.alertWebhookUrl, org.alertSecret, payload);
    const res = await postAlert(org.alertWebhookUrl, body, headers);
    if (res.status < 200 || res.status >= 300) error = `${res.status} ${res.statusText}`.trim();
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
      ...(ticket.test ? { test: true } : {}),
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
