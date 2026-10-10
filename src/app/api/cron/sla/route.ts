import { cronAuthorized } from "@/lib/cron";
import { deliverReply } from "@/lib/email";
import { escalateOverdue } from "@/lib/escalation";
import { syncHubSpot } from "@/lib/integrations/hubspot-sync";
import { wakeSnoozed } from "@/lib/snooze";
import { sendDueReplies } from "@/lib/scheduled-replies";
import { runTimedTriggers } from "@/lib/triggers";
import { runUpdateTimers } from "@/lib/update-timer";

// Every few minutes (vercel.json): wakes snoozed tickets whose time is up, escalates new tickets that missed their
// first-reply target, then runs timed triggers and sends what they wrote, sends replies scheduled for now,
// then logs closed tickets to HubSpot for teams that turned that on.
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const woke = await wakeSnoozed();
  const escalation = await escalateOverdue();
  const updates = await runUpdateTimers().catch((err) => {
    console.error("update timers failed", err);
    return { due: 0 };
  });
  const timed = await runTimedTriggers();
  for (const e of timed.emails) await deliverReply(e.orgId, e.messageId).catch((err) => console.error("timed trigger email failed", e.messageId, err));
  const scheduled = await sendDueReplies().catch((err) => {
    console.error("scheduled replies failed", err);
    return { sent: 0, held: 0 };
  });
  const hubspot = await syncHubSpot().catch((err) => {
    console.error("hubspot sync failed", err);
    return { logged: 0 };
  });
  return Response.json({ ...escalation, woke, timed: timed.ran, updatesDue: updates.due, scheduledSent: scheduled.sent, scheduledHeld: scheduled.held, hubspotLogged: hubspot.logged });
}
