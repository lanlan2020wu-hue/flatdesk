import { and, asc, eq, gt } from "drizzle-orm";
import { db, schema } from "@/db";
import { asJson, build, TYPES } from "@/lib/export";
import { auditLog } from "@/lib/security";
import { safeName, ZipWriter } from "@/lib/zip";

const { attachments, tickets, articles } = schema;
const BATCH = 25;

// Everything a team owns, as the pieces of one zip: every table as JSON, the
// help center, the audit log, and every attachment as its original file.
// Used by the download (app/app/export/archive) and by scheduled backups
// (lib/backups.ts).
export async function* archiveParts(orgId: string, opts: { files?: boolean } = {}): AsyncGenerator<Buffer[]> {
  const zip = new ZipWriter();
  for (const type of TYPES) yield zip.file(`${type}.json`, asJson(await build(orgId, type)));
  const help = await db.select().from(articles).where(eq(articles.orgId, orgId)).orderBy(asc(articles.title));
  yield zip.file("help-articles.json", JSON.stringify(help.map((a) => ({ id: a.id, slug: a.slug, title: a.title, body: a.body, published: a.published, teamOnly: a.internal, section: a.section, createdAt: a.createdAt, updatedAt: a.updatedAt })), null, 2));
  yield zip.file("audit-log.json", JSON.stringify((await auditLog(orgId, undefined, 100_000)).map((e) => ({ at: e.createdAt, actor: e.actorName, actorId: e.actorId, action: e.action, detail: e.detail })), null, 2));

  // Attachments by id, a batch at a time, with a manifest tying each file to its ticket and message.
  // A backup can leave them out (opts.files = false) when a team has too many to hold in one upload.
  const manifest: { path: string; ticket_number: number; message_id: string; filename: string; content_type: string; size: number; created_at: string }[] = [];
  let after = "00000000-0000-0000-0000-000000000000";
  for (; opts.files !== false; ) {
    const rows = await db
      .select({ a: attachments, number: tickets.number })
      .from(attachments)
      .innerJoin(tickets, eq(tickets.id, attachments.ticketId))
      .where(and(eq(attachments.orgId, orgId), gt(attachments.id, after)))
      .orderBy(asc(attachments.id))
      .limit(BATCH);
    if (!rows.length) break;
    for (const { a, number } of rows) {
      const path = `attachments/${number}/${a.id.slice(0, 8)}-${safeName(a.filename)}`;
      yield zip.file(path, Buffer.from(a.data));
      manifest.push({ path, ticket_number: number, message_id: a.messageId, filename: a.filename, content_type: a.contentType, size: a.size, created_at: a.createdAt.toISOString() });
    }
    after = rows[rows.length - 1].a.id;
  }
  yield zip.file("attachments.json", JSON.stringify(manifest, null, 2));
  yield zip.file(
    "README.txt",
    "Flatdesk export\r\n\r\ntickets.json, messages.json, customers.json, macros.json: the same tables as the CSV and JSON downloads in Settings.\r\nhelp-articles.json: your help center.\r\naudit-log.json: who changed what.\r\n"+(opts.files === false ? "attachments.json is empty: this copy was made without attachment files. Download the full archive from Settings, Export, to get them.\r\n" : "attachments/<ticket number>/: every file, as it was sent. attachments.json lists each one with its ticket and message.\r\n"),
  );
  yield [zip.finish()];
}
