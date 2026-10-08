import { randomBytes } from "node:crypto";

// Builds and reads the raw email a mailbox API sends and returns. Only what
// replies need: text and HTML versions, attachments, threading headers.

// A header value, as an RFC 2047 encoded word when it isn't plain ASCII.
export function encodeWord(s: string): string {
  const clean = s.replace(/[\r\n]+/g, " ");
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean).toString("base64")}?=`;
}

// `"Name" <a@b.co>` with the name encoded when needed.
export function addressHeader(name: string | null, email: string): string {
  if (!name) return email;
  const ascii = /^[\x20-\x7e]*$/.test(name);
  return ascii ? `"${name.replace(/["\\]/g, "")}" <${email}>` : `${encodeWord(name)} <${email}>`;
}

const wrap = (b64: string) => b64.replace(/.{1,76}/g, "$&\r\n");
const base64Part = (type: string, data: Buffer, extra: string[] = []) => [`Content-Type: ${type}`, "Content-Transfer-Encoding: base64", ...extra, "", wrap(data.toString("base64"))].join("\r\n");

export type OutgoingMail = {
  from: string; // already formatted, see addressHeader
  to: string;
  cc?: string[];
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
  attachments?: { filename: string; contentType: string; content: Buffer }[];
};

export function buildMime(mail: OutgoingMail, boundary = () => `fd_${randomBytes(12).toString("hex")}`): string {
  const alt = boundary();
  const body = [
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    base64Part('text/plain; charset="UTF-8"', Buffer.from(mail.text)),
    `--${alt}`,
    base64Part('text/html; charset="UTF-8"', Buffer.from(mail.html)),
    `--${alt}--`,
  ].join("\r\n");
  const head = [
    `From: ${mail.from}`,
    `To: ${mail.to}`,
    ...(mail.cc?.length ? [`Cc: ${mail.cc.join(", ")}`] : []),
    `Subject: ${encodeWord(mail.subject)}`,
    "MIME-Version: 1.0",
    ...Object.entries(mail.headers ?? {})
      .filter(([k, v]) => /^[A-Za-z0-9-]+$/.test(k) && v)
      .map(([k, v]) => `${k}: ${v.replace(/[\r\n]+/g, " ")}`),
  ];
  if (!mail.attachments?.length) return [...head, body].join("\r\n");
  const mixed = boundary();
  const files = mail.attachments.map((a) => {
    const name = a.filename.replace(/["\r\n\\]/g, "_");
    const ascii = name.replace(/[^\x20-\x7e]/g, "_");
    return [`--${mixed}`, base64Part(`${a.contentType || "application/octet-stream"}; name="${ascii}"`, a.content, [`Content-Disposition: attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`])].join("\r\n");
  });
  return [...head, `Content-Type: multipart/mixed; boundary="${mixed}"`, "", `--${mixed}`, body, ...files, `--${mixed}--`, ""].join("\r\n");
}

// "A <a@x.co>, \"B, Jr\" <b@y.co>" -> each address, commas inside quotes kept.
export function splitAddresses(header: string | undefined): string[] {
  if (!header) return [];
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  let angle = false;
  for (const ch of header) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "<" && !quoted) angle = true;
    else if (ch === ">" && !quoted) angle = false;
    if (ch === "," && !quoted && !angle) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
