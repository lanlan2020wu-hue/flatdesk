import { cronAuthorized } from "@/lib/cron";
import { deliverReply } from "@/lib/email";
import { escalateOverdue } from "@/lib/escalation";
import { syncHubSpot } from "@/lib/integrations/hubspot-sync";
import { runTimedTriggers } from "@/lib/triggers";

// Every few minutes (vercel.json): escalates new tickets that missed their
// first-reply target, then runs timed triggers and sends what they wrote,
// then logs closed tickets to HubSpot for teams that turned that on.
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const escalation = await escalateOverdue();
  const timed = await runTimedTriggers();
  for (const e of timed.emails) await deliverReply(e.orgId, e.messageId).catch((err) => console.error("timed trigger email failed", e.messageId, err));
  const hubspot = await syncHubSpot().catch((err) => {
    console.error("hubspot sync failed", err);
    return { logged: 0 };
  });
  return Response.json({ ...escalation, timed: timed.ran, hubspotLogged: hubspot.logged });
}
