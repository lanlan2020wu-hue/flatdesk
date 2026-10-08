import { createHmac, timingSafeEqual } from "node:crypto";
import { SITE } from "@/lib/site";

// Flatdesk's Slack app: a team adds it to a channel, new-ticket alerts arrive
// there with Reply, Assign to me and Open buttons, and replying in the Slack
// form sends the reply to the customer by email (or leaves an internal note).
// The person clicking is matched to the Flatdesk team by their Slack email.
//
// One Slack app serves every team. It needs SLACK_CLIENT_ID,
// SLACK_CLIENT_SECRET and SLACK_SIGNING_SECRET, with the redirect URL
// <site>/api/slack/oauth and the interactivity URL <site>/api/slack/interactions.

export const SLACK_SCOPES = ["incoming-webhook", "users:read", "users:read.email"];
const API = "https://slack.com/api";

export const slackAppConfigured = () => Boolean(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET && process.env.SLACK_SIGNING_SECRET);
export const redirectUri = () => `${SITE.url}/api/slack/oauth`;

export class SlackError extends Error {}

// ---- Install ---------------------------------------------------------------------

const STATE_TTL_MS = 15 * 60_000;
const mac = (s: string) => createHmac("sha256", process.env.SLACK_CLIENT_SECRET ?? "").update(s).digest("base64url");

// Ties the Slack round trip to the admin who started it.
export function installState(orgId: string, userId: string, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ o: orgId, u: userId, e: now + STATE_TTL_MS })).toString("base64url");
  return `${body}.${mac(body)}`;
}

export function readState(state: string, now = Date.now()): { orgId: string; userId: string } | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(mac(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const v = JSON.parse(Buffer.from(body, "base64url").toString()) as { o: string; u: string; e: number };
    return typeof v.o === "string" && typeof v.u === "string" && v.e > now ? { orgId: v.o, userId: v.u } : null;
  } catch {
    return null;
  }
}

export function installUrl(state: string) {
  const q = new URLSearchParams({ client_id: process.env.SLACK_CLIENT_ID ?? "", scope: SLACK_SCOPES.join(","), redirect_uri: redirectUri(), state });
  return `https://slack.com/oauth/v2/authorize?${q}`;
}

export type SlackInstall = { token: string; teamId: string; teamName: string; channel: string; channelId: string; webhookUrl: string };

export async function exchangeCode(code: string, fetcher: typeof fetch = fetch): Promise<SlackInstall> {
  const res = await fetcher(`${API}/oauth.v2.access`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.SLACK_CLIENT_ID ?? "", client_secret: process.env.SLACK_CLIENT_SECRET ?? "", redirect_uri: redirectUri() }),
    signal: AbortSignal.timeout(10_000),
  });
  const r = (await res.json()) as { ok: boolean; error?: string; access_token?: string; team?: { id: string; name: string }; incoming_webhook?: { channel: string; channel_id: string; url: string } };
  if (!r.ok || !r.access_token || !r.team || !r.incoming_webhook) throw new SlackError(r.error === "access_denied" ? "Slack wasn't connected." : "Slack didn't finish connecting. Try again.");
  return { token: r.access_token, teamId: r.team.id, teamName: r.team.name, channel: r.incoming_webhook.channel, channelId: r.incoming_webhook.channel_id, webhookUrl: r.incoming_webhook.url };
}

// ---- Requests from Slack ---------------------------------------------------------

// Slack signs each request: v0=HMAC-SHA256("v0:<timestamp>:<raw body>").
export function verifySlackRequest(headers: Headers, rawBody: string, now = Date.now()): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  const ts = headers.get("x-slack-request-timestamp");
  const sig = headers.get("x-slack-signature");
  if (!secret || !ts || !sig || !/^\d+$/.test(ts)) return false;
  if (Math.abs(now / 1000 - Number(ts)) > 300) return false; // replayed
  const want = Buffer.from(`v0=${createHmac("sha256", secret).update(`v0:${ts}:${rawBody}`).digest("hex")}`);
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

export async function slackApi<T>(token: string, method: string, body: Record<string, unknown>, fetcher: typeof fetch = fetch): Promise<T> {
  const res = await fetcher(`${API}/${method}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const r = (await res.json()) as T & { ok: boolean; error?: string };
  if (!r.ok) throw new SlackError(`Slack said ${r.error ?? res.status}.`);
  return r;
}

// users.info wants a form body, not JSON.
export async function slackUserEmail(token: string, userId: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  const res = await fetcher(`${API}/users.info?${new URLSearchParams({ user: userId })}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
  const r = (await res.json()) as { ok: boolean; user?: { profile?: { email?: string } } };
  return r.ok ? (r.user?.profile?.email?.toLowerCase() ?? null) : null;
}

// ---- Messages ----------------------------------------------------------------------

// Slack's mrkdwn treats <, > and & specially.
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// An alert with buttons. The ticket id rides in each button's value.
export function alertBlocks(text: string, ticket: { id: string; number: number; subject: string; url: string }) {
  const ref = esc(`#${ticket.number} ${ticket.subject}`);
  const line = esc(text).replace(ref, () => `<${ticket.url}|${ref.replace(/\|/g, "¦")}>`);
  return [
    { type: "section", text: { type: "mrkdwn", text: line.slice(0, 2900) } },
    {
      type: "actions",
      block_id: "flatdesk_ticket",
      elements: [
        { type: "button", action_id: "reply", text: { type: "plain_text", text: "Reply" }, style: "primary", value: ticket.id },
        { type: "button", action_id: "assign_me", text: { type: "plain_text", text: "Assign to me" }, value: ticket.id },
        { type: "button", action_id: "open", text: { type: "plain_text", text: "Open in Flatdesk" }, url: ticket.url },
      ],
    },
  ];
}

export const REPLY_CALLBACK = "flatdesk_reply";

// The reply form. private_metadata carries the ticket and where to say it went.
export function replyModal(ticket: { id: string; number: number; subject: string; customer: string; lastMessage: string | null }, responseUrl: string | null) {
  const last = ticket.lastMessage ? ticket.lastMessage.replace(/\s+/g, " ").trim() : "";
  return {
    type: "modal",
    callback_id: REPLY_CALLBACK,
    private_metadata: JSON.stringify({ t: ticket.id, r: responseUrl }),
    title: { type: "plain_text", text: `Reply to #${ticket.number}`.slice(0, 24) },
    submit: { type: "plain_text", text: "Send" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*${esc(ticket.subject)}*\nfrom ${esc(ticket.customer)}` } },
      ...(last ? [{ type: "context", elements: [{ type: "mrkdwn", text: `Latest: ${esc(last.length > 280 ? `${last.slice(0, 280)}…` : last)}` }] }] : []),
      { type: "input", block_id: "body", label: { type: "plain_text", text: "Message" }, element: { type: "plain_text_input", action_id: "v", multiline: true, max_length: 3000 } },
      {
        type: "input",
        block_id: "kind",
        label: { type: "plain_text", text: "Send as" },
        element: {
          type: "radio_buttons",
          action_id: "v",
          initial_option: { text: { type: "plain_text", text: "Reply to the customer (emailed)" }, value: "reply" },
          options: [
            { text: { type: "plain_text", text: "Reply to the customer (emailed)" }, value: "reply" },
            { text: { type: "plain_text", text: "Internal note (team only)" }, value: "note" },
          ],
        },
      },
      {
        type: "input",
        block_id: "status",
        label: { type: "plain_text", text: "Then set the ticket to" },
        element: {
          type: "static_select",
          action_id: "v",
          initial_option: { text: { type: "plain_text", text: "Pending (waiting on them)" }, value: "pending" },
          options: [
            { text: { type: "plain_text", text: "Pending (waiting on them)" }, value: "pending" },
            { text: { type: "plain_text", text: "Open" }, value: "open" },
            { text: { type: "plain_text", text: "Closed" }, value: "closed" },
          ],
        },
      },
    ],
  };
}

// What the person typed in the reply form.
export function readReply(values: Record<string, Record<string, { value?: string; selected_option?: { value: string } }>>) {
  const body = (values.body?.v?.value ?? "").trim();
  const internal = values.kind?.v?.selected_option?.value === "note";
  const s = values.status?.v?.selected_option?.value;
  const status = s === "open" || s === "pending" || s === "closed" ? s : "pending";
  return { body, internal, status } as const;
}

// The alert with a line added under it, saying who did what.
export function withNote(blocks: unknown[] | undefined, line: string) {
  return [...(blocks ?? []), { type: "context", elements: [{ type: "mrkdwn", text: esc(line) }] }].slice(-50);
}
