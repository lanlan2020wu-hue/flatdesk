import { downloadResponse, loadAttachment } from "@/lib/attachments";
import { LOCKED_MESSAGE, requireSession, teamPlan } from "@/lib/auth";

// Agents download a ticket's files here. `?download=1` forces a download
// instead of showing an image or PDF in the browser.
export async function GET(request: Request, ctx: RouteContext<"/app/attachments/[id]">) {
  const s = await requireSession();
  if ((await teamPlan(s.orgId)).plan.state === "locked") return Response.json({ error: LOCKED_MESSAGE }, { status: 402 });
  const row = await loadAttachment(s.orgId, (await ctx.params).id);
  if (!row) return new Response("Not found", { status: 404 });
  return downloadResponse(row, new URL(request.url).searchParams.has("download"));
}
