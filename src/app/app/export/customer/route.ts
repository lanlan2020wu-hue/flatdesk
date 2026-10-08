import { requireAdmin } from "@/lib/auth";
import { customerExport, maskEmail } from "@/lib/customer-data";
import { audit } from "@/lib/security";

// One customer's data as JSON, for a data access request: ?id=<customer id>. Admins only.
export async function GET(request: Request) {
  const s = await requireAdmin();
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const data = await customerExport(s.orgId, id);
  if (!data) return new Response("Not found", { status: 404 });
  await audit(s.orgId, { userId: s.userId, name: s.name }, "customer.export", `${maskEmail(data.customer.email)}, ${data.tickets.length} ${data.tickets.length === 1 ? "ticket" : "tickets"}`);
  const name = data.customer.email.replace(/[^a-z0-9.@_-]/gi, "_");
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="flatdesk-customer-${name}.json"`,
      "cache-control": "no-store",
    },
  });
}
