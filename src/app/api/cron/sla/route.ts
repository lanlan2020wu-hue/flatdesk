import { cronAuthorized } from "@/lib/cron";
import { deliverReply } from "@/lib/email";
import { escalateOverdue } from "@/lib/escalation";
import { runTimedTriggers } from "@/lib/triggers";

// Every few minutes (vercel.json): escalates new tickets that missed their
// first-reply target, then runs timed triggers and sends what they wrote.
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const escalation = await escalateOverdue();
  const timed = await runTimedTriggers();
  for (const e of timed.emails) await deliverReply(e.orgId, e.messageId).catch((err) => console.error("timed trigger email failed", e.messageId, err));
  return Response.json({ ...escalation, timed: timed.ran });
}
