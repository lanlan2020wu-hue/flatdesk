import { count, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/security";
import { archiveParts } from "@/lib/archive";
import { ZIP_LIMITS } from "@/lib/zip";

export const maxDuration = 300;

const { attachments } = schema;

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
