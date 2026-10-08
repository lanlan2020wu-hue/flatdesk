import { and, asc, count, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { asJson, build, TYPES } from "@/lib/export";
import { audit, auditLog } from "@/lib/security";
import { safeName, ZIP_LIMITS, ZipWriter } from "@/lib/zip";

export const maxDuration = 300;

const { attachments, tickets, articles } = schema;
const BATCH = 25;

// Everything in one download: every table as JSON, the help center, the audit
// log, and every attachment as its original file under attachments/<ticket>/.
// Streamed one file at a time, so it never holds the whole archive in memory.
export async function GET() {
  const s = await requireSession();
  const [totals] = await db
    .select({ files: count(), bytes: sql<string>`coalesce(sum(${attachments.size}), 0)` })
    .from(attachments)
    .where(eq(attachments.orgId, s.orgId));
  if (Number(totals.files) > ZIP_LIMITS.files || Number(totals.bytes) > ZIP_LIMITS.bytes) {
    return new Response("Your team has more files than one archive can hold. Email us and we'll send the export in parts.", { status: 413 });
  }
  await audit(s.orgId, { userId: s.userId, name: s.name }, "export.archive", `${totals.files} attachments`);

  const files = archiveParts(s.orgId);
  // pull() asks for the next file only when the last one has been read, so a slow download doesn't pile files up in memory.
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await files.next();
        if (done) controller.close();
        else value.forEach((p) => controller.enqueue(new Uint8Array(p.buffer, p.byteOffset, p.byteLength)));
      } catch (err) {
        console.error("archive export failed", err);
        controller.error(err);
      }
    },
  });

  const date = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="flatdesk-archive-${date}.zip"`,
      "cache-control": "no-store",
    },
  });
}

async function* archiveParts(orgId: string): AsyncGenerator<Buffer[]> {
  const zip = new ZipWriter();
  for (const type of TYPES) yield zip.file(`${type}.json`, asJson(await build(orgId, type)));
  const help = await db.select().from(articles).where(eq(articles.orgId, orgId)).orderBy(asc(articles.title));
  yield zip.file("help-articles.json", JSON.stringify(help.map((a) => ({ id: a.id, slug: a.slug, title: a.title, body: a.body, published: a.published, teamOnly: a.internal, section: a.section, createdAt: a.createdAt, updatedAt: a.updatedAt })), null, 2));
  yield zip.file("audit-log.json", JSON.stringify((await auditLog(orgId, undefined, 100_000)).map((e) => ({ at: e.createdAt, actor: e.actorName, actorId: e.actorId, action: e.action, detail: e.detail })), null, 2));

  // Attachments by id, a batch at a time, with a manifest tying each file to its ticket and message.
  const manifest: { path: string; ticket_number: number; message_id: string; filename: string; content_type: string; size: number; created_at: string }[] = [];
  let after = "00000000-0000-0000-0000-000000000000";
  for (;;) {
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
    "Flatdesk export\r\n\r\ntickets.json, messages.json, customers.json, macros.json: the same tables as the CSV and JSON downloads in Settings.\r\nhelp-articles.json: your help center.\r\naudit-log.json: who changed what.\r\nattachments/<ticket number>/: every file, as it was sent. attachments.json lists each one with its ticket and message.\r\n",
  );
  yield [zip.finish()];
}
