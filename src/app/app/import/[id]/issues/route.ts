import { requireAdmin } from "@/lib/auth";
import { getImport, issueRows } from "@/lib/import/report";

// Every record that couldn't be fully carried over, one row per issue.
export async function GET(_req: Request, ctx: RouteContext<"/app/import/[id]/issues">) {
  const s = await requireAdmin();
  const { id } = await ctx.params;
  const job = await getImport(s.orgId, id);
  if (!job) return new Response("Not found", { status: 404 });
  const rows = await issueRows(s.orgId, id);
  const cell = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["Type", "Original ID", "Name", "Imported into Flatdesk", "Issue"].map(cell).join(",")];
  for (const r of rows) for (const issue of r.issues) lines.push([r.kind, r.externalId, r.label, r.mappedId ? "yes" : "no, kept in archive", issue].map(cell).join(","));
  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="flatdesk-import-${job.source}-issues.csv"`,
    },
  });
}
