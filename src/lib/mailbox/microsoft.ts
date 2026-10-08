import { createHmac, timingSafeEqual } from "node:crypto";
import { SITE } from "@/lib/site";

// Outlook and Microsoft 365 through Microsoft Graph: the team signs in with
// Microsoft once, Flatdesk reads new mail in the inbox and sends replies from
// the mailbox, threaded on the customer's message. Needs MICROSOFT_CLIENT_ID
// and MICROSOFT_CLIENT_SECRET from an app registration (accounts in any
// organization and personal accounts) with the redirect URI
// <site>/api/mailbox/microsoft/oauth and the delegated permissions below.

export const MICROSOFT_SCOPES = ["offline_access", "User.Read", "Mail.ReadWrite", "Mail.Send"];
const LOGIN = "https://login.microsoftonline.com/common/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0/me";

export const microsoftConfigured = () => Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
export const microsoftRedirectUri = () => `${SITE.url}/api/mailbox/microsoft/oauth`;

export class MicrosoftError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

// ---- Sign-in ----------------------------------------------------------------------

const STATE_TTL_MS = 15 * 60_000;
const mac = (s: string) => createHmac("sha256", `microsoft:${process.env.MICROSOFT_CLIENT_SECRET ?? ""}`).update(s).digest("base64url");

export function microsoftState(orgId: string, userId: string, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ o: orgId, u: userId, e: now + STATE_TTL_MS })).toString("base64url");
  return `${body}.${mac(body)}`;
}

export function readMicrosoftState(state: string, now = Date.now()): { orgId: string; userId: string } | null {
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

export function microsoftAuthUrl(state: string) {
  const q = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID ?? "",
    redirect_uri: microsoftRedirectUri(),
    response_type: "code",
    response_mode: "query",
    scope: MICROSOFT_SCOPES.join(" "),
    prompt: "select_account",
    state,
  });
  return `${LOGIN}/authorize?${q}`;
}

export type MicrosoftTokens = { refresh: string; access: string; expires: string };

async function token(params: Record<string, string>, fetcher: typeof fetch) {
  const res = await fetcher(`${LOGIN}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID ?? "", client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? "", scope: MICROSOFT_SCOPES.join(" "), ...params }),
    signal: AbortSignal.timeout(10_000),
  });
  const r = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
  if (!res.ok || !r.access_token) {
    throw new MicrosoftError(r.error === "invalid_grant" ? "Microsoft sign-in for this mailbox expired or was revoked. Connect it again." : "Microsoft didn't finish signing in. Try again.", res.status);
  }
  return { access_token: r.access_token, refresh_token: r.refresh_token, expires_in: r.expires_in ?? 3600, scope: r.scope ?? "" };
}

const expiry = (seconds: number, now = Date.now()) => new Date(now + (seconds - 60) * 1000).toISOString();

export async function exchangeMicrosoftCode(code: string, fetcher: typeof fetch = fetch): Promise<MicrosoftTokens> {
  const r = await token({ code, grant_type: "authorization_code", redirect_uri: microsoftRedirectUri() }, fetcher);
  if (!r.refresh_token) throw new MicrosoftError("Microsoft didn't give Flatdesk lasting access. Try connecting again.");
  const granted = r.scope.toLowerCase().split(" ");
  if (!["mail.readwrite", "mail.send"].every((s) => granted.some((g) => g === s || g.endsWith(`/${s}`)))) {
    throw new MicrosoftError("Flatdesk needs permission to read and send mail. Your Microsoft 365 admin may need to approve Flatdesk first.");
  }
  return { refresh: r.refresh_token, access: r.access_token, expires: expiry(r.expires_in) };
}

export async function freshMicrosoftTokens(t: MicrosoftTokens, fetcher: typeof fetch = fetch, now = Date.now()): Promise<{ tokens: MicrosoftTokens; changed: boolean }> {
  if (new Date(t.expires).getTime() > now) return { tokens: t, changed: false };
  const r = await token({ refresh_token: t.refresh, grant_type: "refresh_token" }, fetcher);
  return { tokens: { refresh: r.refresh_token ?? t.refresh, access: r.access_token, expires: expiry(r.expires_in, now) }, changed: true };
}

// ---- The mailbox ------------------------------------------------------------------

async function graph<T>(access: string, path: string, init: RequestInit & { prefer?: string } = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${access}` };
  if (init.body) headers["content-type"] = "application/json";
  if (init.prefer) headers.prefer = init.prefer;
  const res = await fetcher(`${GRAPH}${path}`, { ...init, headers, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    const r = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    const message =
      res.status === 401 ? "Microsoft sign-in for this mailbox expired. Connect it again."
      : res.status === 403 ? "Microsoft refused: the mailbox no longer allows Flatdesk to read or send mail. Connect it again."
      : res.status === 429 ? "Microsoft asked Flatdesk to slow down. It tries again in a few minutes."
      : `Microsoft said ${r.error?.message ?? res.status}.`;
    throw new MicrosoftError(message, res.status);
  }
  return (res.status === 202 || res.status === 204 ? {} : await res.json()) as T;
}

export async function microsoftProfile(access: string, fetcher?: typeof fetch): Promise<{ address: string }> {
  const r = await graph<{ mail?: string | null; userPrincipalName?: string }>(access, "?$select=mail,userPrincipalName", {}, fetcher);
  const address = (r.mail || r.userPrincipalName || "").toLowerCase();
  if (!address.includes("@")) throw new MicrosoftError("That Microsoft account has no mailbox.");
  return { address };
}

type Recipient = { emailAddress?: { name?: string; address?: string } };
export type GraphMessage = {
  id: string;
  receivedDateTime: string;
  subject?: string;
  from?: Recipient;
  toRecipients?: Recipient[];
  ccRecipients?: Recipient[];
  internetMessageId?: string;
  internetMessageHeaders?: { name: string; value: string }[];
  body?: { contentType: "text" | "html"; content: string };
  hasAttachments?: boolean;
};

const FIELDS = "id,receivedDateTime,subject,from,toRecipients,ccRecipients,internetMessageId,internetMessageHeaders,body,hasAttachments";

// Inbox messages received after `since`, oldest first.
export async function newInboxMessagesGraph(access: string, since: string, fetcher?: typeof fetch, max = 25): Promise<GraphMessage[]> {
  const q = new URLSearchParams({ $filter: `receivedDateTime ge ${since}`, $orderby: "receivedDateTime asc", $top: String(max), $select: FIELDS });
  const r = await graph<{ value: GraphMessage[] }>(access, `/mailFolders/inbox/messages?${q}`, { prefer: 'outlook.body-content-type="text"' }, fetcher);
  return r.value;
}

export async function graphAttachments(access: string, id: string, fetcher?: typeof fetch) {
  const r = await graph<{ value: { "@odata.type": string; name?: string; contentType?: string; size?: number; isInline?: boolean; contentBytes?: string }[] }>(
    access,
    `/messages/${encodeURIComponent(id)}/attachments`,
    {},
    fetcher,
  );
  return r.value.filter((a) => a["@odata.type"] === "#microsoft.graph.fileAttachment" && a.contentBytes);
}

export const recipientText = (r?: Recipient) => (r?.emailAddress?.address ? (r.emailAddress.name ? `"${r.emailAddress.name.replace(/"/g, "")}" <${r.emailAddress.address}>` : r.emailAddress.address) : "");

export type GraphReply = {
  to: string;
  cc?: string[];
  subject: string;
  html: string;
  inReplyTo?: string; // the customer's Message-ID, to thread on it
  headers?: Record<string, string>; // only x- headers are allowed by Graph
  attachments?: { filename: string; contentType: string; content: Buffer }[];
};

// Sends from the mailbox. Replies on the customer's own message when it's in
// the mailbox, so Outlook and the customer's client thread it. Returns the
// new message's Message-ID.
export async function sendGraph(access: string, mail: GraphReply, fetcher?: typeof fetch): Promise<{ messageId: string | null }> {
  let draftId: string | null = null;
  if (mail.inReplyTo) {
    const q = new URLSearchParams({ $filter: `internetMessageId eq '${mail.inReplyTo.replace(/'/g, "''")}'`, $select: "id", $top: "1" });
    const found = await graph<{ value: { id: string }[] }>(access, `/messages?${q}`, {}, fetcher).catch(() => ({ value: [] }));
    if (found.value[0]) draftId = (await graph<{ id: string }>(access, `/messages/${encodeURIComponent(found.value[0].id)}/createReply`, { method: "POST" }, fetcher)).id;
  }
  const fields = {
    subject: mail.subject,
    body: { contentType: "html", content: mail.html },
    toRecipients: [{ emailAddress: { address: mail.to } }],
    ccRecipients: (mail.cc ?? []).map((address) => ({ emailAddress: { address } })),
  };
  // Graph takes only x- headers, and only on a new message (not a reply draft).
  const xHeaders = Object.entries(mail.headers ?? {})
    .filter(([k]) => /^x-/i.test(k))
    .map(([name, value]) => ({ name, value }));
  if (draftId) await graph(access, `/messages/${encodeURIComponent(draftId)}`, { method: "PATCH", body: JSON.stringify(fields) }, fetcher);
  else draftId = (await graph<{ id: string }>(access, "/messages", { method: "POST", body: JSON.stringify(xHeaders.length ? { ...fields, internetMessageHeaders: xHeaders } : fields) }, fetcher)).id;
  for (const a of mail.attachments ?? []) {
    await graph(
      access,
      `/messages/${encodeURIComponent(draftId)}/attachments`,
      { method: "POST", body: JSON.stringify({ "@odata.type": "#microsoft.graph.fileAttachment", name: a.filename, contentType: a.contentType, contentBytes: a.content.toString("base64") }) },
      fetcher,
    );
  }
  const meta = await graph<{ internetMessageId?: string }>(access, `/messages/${encodeURIComponent(draftId)}?$select=internetMessageId`, {}, fetcher).catch(() => ({ internetMessageId: undefined }));
  await graph(access, `/messages/${encodeURIComponent(draftId)}/send`, { method: "POST" }, fetcher);
  return { messageId: meta.internetMessageId ?? null };
}
