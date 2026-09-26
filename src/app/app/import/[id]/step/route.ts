import { requireAdmin } from "@/lib/auth";
import { runStep } from "@/lib/import/engine";

// The import page calls this in a loop while an import runs. Each call does
// about 20 seconds of work and returns where things stand.
export const maxDuration = 60;

export async function POST(_req: Request, ctx: RouteContext<"/app/import/[id]/step">) {
  const s = await requireAdmin();
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const job = await runStep(s.orgId, id);
  if (!job) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({
    status: job.status,
    phase: job.phase,
    retryAt: job.retryAt,
    // Another tab holds the step; wait instead of hammering.
    busy: Boolean(job.lockedUntil && job.lockedUntil > new Date()),
  });
}
