import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { isUuid } from "@/lib/ids";

// Files on tickets: what customers attach to emails, and what agents attach to
// replies. Bytes live in Postgres (the attachments table), so a download is
// checked against the same org or chat visitor as the ticket it belongs to.

const { attachments } = schema;

// Vercel caps a request body at 4.5 MB, so files uploaded with a reply share
// this budget. Inbound email is fetched server-side and can be larger.
export const REPLY_UPLOAD_LIMIT = 4 * 1024 * 1024;
export const INBOUND_FILE_LIMIT = 20 * 1024 * 1024;
export const INBOUND_TOTAL_LIMIT = 30 * 1024 * 1024;
export const MAX_FILES = 10;
// Inline images below this size are almost always signature logos and icons.
const INLINE_NOISE = 12 * 1024;

export type NewFile = { filename: string; contentType: string; data: Buffer };
export type AttachmentInfo = { id: string; messageId: string; filename: string; contentType: string; size: number };

export function cleanFilename(name: string | null | undefined): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f"<>|:*?]/g, "").trim().slice(0, 200);
  return cleaned || "attachment";
}

export async function saveAttachments(orgId: string, ticketId: string, messageId: string, files: NewFile[]) {
  const rows = files.slice(0, MAX_FILES).map((f) => ({
    orgId,
    ticketId,
    messageId,
    filename: cleanFilename(f.filename),
    contentType: f.contentType || "application/octet-stream",
    size: f.data.length,
    data: f.data,
  }));
  if (rows.length) await db.insert(attachments).values(rows);
  return rows.length;
}

// Files from a reply form. Throws a readable error when they're over budget.
export async function filesFromForm(form: FormData, key = "files"): Promise<NewFile[]> {
  const files = form.getAll(key).filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && f.size > 0);
  if (files.length > MAX_FILES) throw new Error(`Attach up to ${MAX_FILES} files per reply.`);
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > REPLY_UPLOAD_LIMIT) throw new Error("Attachments on one reply can add up to 4 MB.");
  return Promise.all(files.map(async (f) => ({ filename: f.name, contentType: f.type, data: Buffer.from(await f.arrayBuffer()) })));
}

// Metadata (no bytes) for the messages of a ticket, grouped by message.
export async function attachmentsByMessage(orgId: string, messageIds: string[]) {
  const map = new Map<string, AttachmentInfo[]>();
  if (messageIds.length === 0) return map;
  const rows = await db
    .select({ id: attachments.id, messageId: attachments.messageId, filename: attachments.filename, contentType: attachments.contentType, size: attachments.size })
    .from(attachments)
    .where(and(eq(attachments.orgId, orgId), inArray(attachments.messageId, messageIds)))
    .orderBy(asc(attachments.createdAt));
  for (const r of rows) map.set(r.messageId, [...(map.get(r.messageId) ?? []), r]);
  return map;
}

export async function loadAttachment(orgId: string, id: string, ticketId?: string) {
  if (!isUuid(id)) return null;
  const where = [eq(attachments.orgId, orgId), eq(attachments.id, id)];
  if (ticketId) where.push(eq(attachments.ticketId, ticketId));
  const [row] = await db.select().from(attachments).where(and(...where));
  return row ?? null;
}

// For sending a reply by email.
export async function emailAttachments(messageId: string) {
  const rows = await db
    .select({ filename: attachments.filename, contentType: attachments.contentType, data: attachments.data })
    .from(attachments)
    .where(eq(attachments.messageId, messageId))
    .orderBy(asc(attachments.createdAt));
  return rows.map((r) => ({ filename: r.filename, contentType: r.contentType, content: r.data }));
}

// Types a browser may show in place. Everything else downloads. SVG and HTML
// always download, since they can carry scripts.
const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp)|application\/pdf|text\/plain)$/i;

export function downloadResponse(row: { filename: string; contentType: string; data: Buffer }, forceDownload = false) {
  const inline = !forceDownload && INLINE_TYPES.test(row.contentType);
  const ascii = row.filename.replace(/[^\x20-\x7e]/g, "_");
  return new Response(new Uint8Array(row.data), {
    headers: {
      "content-type": inline ? row.contentType : "application/octet-stream",
      "content-length": String(row.data.length),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      "cache-control": "private, max-age=3600",
    },
  });
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

type InboundMeta = { id: string; filename?: string | null; size: number; content_type: string; content_disposition?: string | null; download_url: string };

// Picks which inbound email attachments to keep and downloads them. Files
// that are too big are named in the returned `skipped` list, so the ticket can
// say so instead of silently dropping them.
export async function downloadInbound(list: InboundMeta[], fetcher: typeof fetch = fetch) {
  const files: NewFile[] = [];
  const skipped: string[] = [];
  let total = 0;
  for (const a of list) {
    const name = cleanFilename(a.filename);
    if (a.content_disposition === "inline" && a.content_type.startsWith("image/") && a.size < INLINE_NOISE) continue;
    if (files.length >= MAX_FILES || a.size > INBOUND_FILE_LIMIT || total + a.size > INBOUND_TOTAL_LIMIT) {
      skipped.push(name);
      continue;
    }
    try {
      const r = await fetcher(a.download_url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = Buffer.from(await r.arrayBuffer());
      total += data.length;
      files.push({ filename: name, contentType: a.content_type, data });
    } catch (err) {
      console.error("attachment download failed", name, err);
      skipped.push(name);
    }
  }
  return { files, skipped };
}
