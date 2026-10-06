import { requireSession } from "@/lib/auth";
import { asJson, build, csv, TYPES } from "@/lib/export";
import { audit } from "@/lib/security";

// Everything a team owns, as CSV or JSON: ?type=tickets|messages|customers|macros&format=csv|json
export async function GET(request: Request) {
  const s = await requireSession();
  const params = new URL(request.url).searchParams;
  const type = TYPES.includes(params.get("type") ?? "") ? params.get("type")! : "tickets";
  const json = params.get("format") === "json";
  const table = await build(s.orgId, type);
  await audit(s.orgId, { userId: s.userId, name: s.name }, "export.download", `${type}, ${json ? "JSON" : "CSV"}`);
  const date = new Date().toISOString().slice(0, 10);
  const body = json ? asJson(table) : csv(table.header, table.rows);
  return new Response(body, {
    headers: {
      "content-type": json ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="flatdesk-${type}-${date}.${json ? "json" : "csv"}"`,
      "cache-control": "no-store",
    },
  });
}
