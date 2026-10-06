import { cronAuthorized } from "@/lib/cron";
import { escalateOverdue } from "@/lib/escalation";

// Every few minutes (vercel.json): escalates new tickets that missed their first-reply target.
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await escalateOverdue());
}
