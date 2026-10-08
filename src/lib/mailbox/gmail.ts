import { createHmac, timingSafeEqual } from "node:crypto";
import { SITE } from "@/lib/site";

// Gmail through Google's API: the team signs in with Google once, Flatdesk
// reads new mail in the inbox and sends replies from the mailbox, so they
// show in its Sent folder. Needs GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET from
// a Google Cloud OAuth client (web application) with the redirect URI
// <site>/api/mailbox/gmail/oauth and the Gmail API turned on.

export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"];
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export const gmailConfigured = () => Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET);
export const gmailRedirectUri = () => `${SITE.url}/api/mailbox/gmail/oauth`;

export class GmailError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

// ---- Sign-in ----------------------------------------------------------------------

const STATE_TTL_MS = 15 * 60_000;
const mac = (s: string) => createHmac("sha256", `gmail:${process.env.GMAIL_CLIENT_SECRET ?? ""}`).update(s).digest("base64url");

// Ties Google's round trip to the admin who started it.
export function gmailState(orgId: string, userId: string, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ o: orgId, u: userId, e: now + STATE_TTL_MS })).toString("base64url");
  return `${body}.${mac(body)}`;
}

export function readGmailState(state: string, now = Date.now()): { orgId: string; userId: string } | null {
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

export function gmailAuthUrl(state: string, hint?: string) {
  const q = new URLSearchParams({
    client_id: process.env.GMAIL_CLIENT_ID ?? "",
    redirect_uri: gmailRedirectUri(),
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // always hands back a refresh token
    include_granted_scopes: "true",
    state,
  });
  if (hint) q.set("login_hint", hint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export type GmailTokens = { refresh: string; access: string; expires: string };

async function token(params: Record<string, string>, fetcher: typeof fetch): Promise<{ access_token: string; refresh_token?: string; expires_in: number; scope?: string }> {
  const res = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GMAIL_CLIENT_ID ?? "", client_secret: process.env.GMAIL_CLIENT_SECRET ?? "", ...params }),
    signal: AbortSignal.timeout(10_000),
  });
  const r = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
  if (!res.ok || !r.access_token) {
    throw new GmailError(r.error === "invalid_grant" ? "Google sign-in for this mailbox expired or was revoked. Connect it again." : "Google didn't finish signing in. Try again.", res.status);
  }
  return { access_token: r.access_token, refresh_token: r.refresh_token, expires_in: r.expires_in ?? 3600, scope: r.scope };
}

const expiry = (seconds: number, now = Date.now()) => new Date(now + (seconds - 60) * 1000).toISOString();

export async function exchangeGmailCode(code: string, fetcher: typeof fetch = fetch): Promise<GmailTokens> {
  const r = await token({ code, grant_type: "authorization_code", redirect_uri: gmailRedirectUri() }, fetcher);
  if (!r.refresh_token) throw new GmailError("Google didn't give Flatdesk lasting access. Try connecting again.");
  const granted = (r.scope ?? "").split(" ");
  if (!GMAIL_SCOPES.every((s) => granted.includes(s))) throw new GmailError("Flatdesk needs both permissions, reading and sending mail. Connect again and leave both boxes ticked.");
  return { refresh: r.refresh_token, access: r.access_token, expires: expiry(r.expires_in) };
}

// A fresh access token when the saved one is about to run out. Returns the
// tokens to use and whether they changed (and so need saving).
export async function freshTokens(t: GmailTokens, fetcher: typeof fetch = fetch, now = Date.now()): Promise<{ tokens: GmailTokens; changed: boolean }> {
  if (new Date(t.expires).getTime() > now) return { tokens: t, changed: false };
  const r = await token({ refresh_token: t.refresh, grant_type: "refresh_token" }, fetcher);
  return { tokens: { refresh: r.refresh_token ?? t.refresh, access: r.access_token, expires: expiry(r.expires_in, now) }, changed: true };
}

export async function revokeGmail(t: GmailTokens, fetcher: typeof fetch = fetch) {
  await fetcher(`https://oauth2.googleapis.com/revoke?${new URLSearchParams({ token: t.refresh })}`, { method: "POST", signal: AbortSignal.timeout(5000) }).catch(() => {});
}

// ---- The mailbox ------------------------------------------------------------------

async function gmail<T>(access: string, path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const res = await fetcher(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${access}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const r = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string } };
    const message =
      res.status === 401 ? "Google sign-in for this mailbox expired. Connect it again."
      : res.status === 403 ? "Google refused: the mailbox no longer allows Flatdesk to read or send mail. Connect it again."
      : res.status === 429 ? "Gmail asked Flatdesk to slow down. It tries again in a few minutes."
      : `Gmail said ${r.error?.message ?? res.status}.`;
    throw new GmailError(message, res.status);
  }
  return (await res.json()) as T;
}

export const gmailProfile = (access: string, fetcher?: typeof fetch) => gmail<{ emailAddress: string; historyId: string }>(access, "/profile", {}, fetcher);

// Ids of messages added to the inbox since `historyId`, oldest first, and where to
// start next time. `expired` when Gmail no longer has history that old.
export async function newInboxMessages(access: string, historyId: string, fetcher?: typeof fetch, max = 50): Promise<{ ids: string[]; historyId: string; expired?: boolean }> {
  const ids: string[] = [];
  let next = historyId;
  let pageToken: string | undefined;
  try {
    do {
      const q = new URLSearchParams({ startHistoryId: historyId, historyTypes: "messageAdded", labelId: "INBOX", maxResults: "100" });
      if (pageToken) q.set("pageToken", pageToken);
      const r = await gmail<{ history?: { id: string; messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[]; historyId: string; nextPageToken?: string }>(access, `/history?${q}`, {}, fetcher);
      for (const h of r.history ?? []) {
        for (const { message } of h.messagesAdded ?? []) {
          const labels = message.labelIds ?? [];
          if (!labels.includes("INBOX") || labels.includes("SENT") || labels.includes("SPAM") || labels.includes("DRAFT") || ids.includes(message.id)) continue;
          if (ids.length >= max) return { ids, historyId: next }; // the rest next run
          ids.push(message.id);
        }
        next = h.id;
      }
      next = r.nextPageToken ? next : r.historyId;
      pageToken = r.nextPageToken;
    } while (pageToken);
  } catch (err) {
    if (err instanceof GmailError && err.status === 404) {
      const profile = await gmailProfile(access, fetcher);
      return { ids: [], historyId: profile.historyId, expired: true };
    }
    throw err;
  }
  return { ids, historyId: next };
}

type Part = { partId?: string; mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { size?: number; data?: string; attachmentId?: string }; parts?: Part[] };
export type GmailMessage = { id: string; threadId: string; labelIds?: string[]; payload: Part };

export const getGmailMessage = (access: string, id: string, fetcher?: typeof fetch) => gmail<GmailMessage>(access, `/messages/${encodeURIComponent(id)}?format=full`, {}, fetcher);

export async function gmailAttachment(access: string, messageId: string, attachmentId: string, fetcher?: typeof fetch): Promise<Buffer> {
  const r = await gmail<{ data: string }>(access, `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, {}, fetcher);
  return Buffer.from(r.data, "base64url");
}

// The parts of a message Flatdesk uses: headers, text, HTML and files.
export function readGmailMessage(m: GmailMessage) {
  const headers: Record<string, string> = {};
  for (const h of m.payload.headers ?? []) headers[h.name] = headers[h.name] ? `${headers[h.name]}\n${h.value}` : h.value;
  let text = "";
  let html = "";
  const files: { filename: string; contentType: string; size: number; inline: boolean; attachmentId?: string; data?: string }[] = [];
  const walk = (p: Part) => {
    const disposition = (p.headers ?? []).find((h) => h.name.toLowerCase() === "content-disposition")?.value ?? "";
    if (p.filename && (p.body?.attachmentId || p.body?.data)) {
      files.push({ filename: p.filename, contentType: p.mimeType ?? "application/octet-stream", size: p.body.size ?? 0, inline: /^\s*inline/i.test(disposition), attachmentId: p.body.attachmentId, data: p.body.data });
    } else if (p.mimeType === "text/plain" && p.body?.data && !text) text = Buffer.from(p.body.data, "base64url").toString("utf8");
    else if (p.mimeType === "text/html" && p.body?.data && !html) html = Buffer.from(p.body.data, "base64url").toString("utf8");
    for (const c of p.parts ?? []) walk(c);
  };
  walk(m.payload);
  const header = (name: string) => Object.entries(headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
  return { headers, header, text, html, files };
}

// Sends a raw RFC 2822 message. Returns the Message-ID Gmail gave it, which
// customer replies refer to.
export async function sendGmail(access: string, raw: string, fetcher?: typeof fetch): Promise<{ id: string; messageId: string | null }> {
  const sent = await gmail<{ id: string }>(access, "/messages/send", { method: "POST", body: JSON.stringify({ raw: Buffer.from(raw).toString("base64url") }) }, fetcher);
  try {
    const meta = await gmail<GmailMessage>(access, `/messages/${encodeURIComponent(sent.id)}?format=metadata&metadataHeaders=Message-ID`, {}, fetcher);
    const id = meta.payload.headers?.find((h) => h.name.toLowerCase() === "message-id")?.value ?? null;
    return { id: sent.id, messageId: id };
  } catch {
    return { id: sent.id, messageId: null };
  }
}
