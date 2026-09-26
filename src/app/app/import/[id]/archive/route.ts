import { and, asc, eq, gt, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { getImport } from "@/lib/import/report";

// Everything read from the old help desk, exactly as its API returned it, one
// JSON record per line. Streamed in pages so large imports don't sit in memory.
export const maxDuration = 300;

export async function GET(_req: Request, ctx: RouteContext<"/app/import/[id]/archive">) {
  const s = await requireAdmin();
  const { id } = await ctx.params;
  const job = await getImport(s.orgId, id);
  if (!job) return new Response("Not found", { status: 404 });
  const r = schema.importRecords;
  const encoder = new TextEncoder();

  let after: { kind: string; externalId: string } | null = null;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const page = await db
        .select({ kind: r.kind, externalId: r.externalId, mappedId: r.mappedId, issues: r.issues, raw: r.raw })
        .from(r)
        .where(
          and(
            eq(r.orgId, s.orgId),
            eq(r.importId, id),
            after ? or(gt(r.kind, after.kind), and(eq(r.kind, after.kind), gt(r.externalId, after.externalId))) : undefined,
          ),
        )
        .orderBy(asc(r.kind), asc(r.externalId))
        .limit(500);
      if (!page.length) return controller.close();
      after = page[page.length - 1];
      controller.enqueue(encoder.encode(page.map((row) => JSON.stringify({ source: job.source, ...row })).join("\n") + "\n"));
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="flatdesk-import-${job.source}-archive.jsonl"`,
    },
  });
}
