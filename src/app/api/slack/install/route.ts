import { redirect } from "next/navigation";
import { requireAdmin, requireOpen } from "@/lib/auth";
import { installState, installUrl, slackAppConfigured } from "@/lib/integrations/slack";

// "Add to Slack" on /app/integrations: off to Slack to pick a channel.
export async function GET() {
  const s = await requireOpen(await requireAdmin());
  if (!slackAppConfigured()) redirect("/app/integrations#slack");
  redirect(installUrl(installState(s.orgId, s.userId)));
}
