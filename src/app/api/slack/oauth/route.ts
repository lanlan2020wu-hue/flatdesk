import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { connectSlack } from "@/lib/integrations";
import { exchangeCode, readState, SlackError } from "@/lib/integrations/slack";
import { audit } from "@/lib/security";

// Slack sends the admin back here after they pick a channel.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (params: Record<string, string>) => redirect(`/app/integrations?${new URLSearchParams(params)}#slack`);
  const s = await requireAdmin();
  const state = readState(url.searchParams.get("state") ?? "");
  // The same admin who started, on the same team, within a few minutes.
  if (!state || state.orgId !== s.orgId || state.userId !== s.userId) back({ slack: "That Slack link expired. Try Add to Slack again." });
  const code = url.searchParams.get("code");
  if (!code) back({ slack: url.searchParams.get("error") === "access_denied" ? "Slack wasn't connected." : "Slack didn't finish connecting. Try again." });
  let message = "";
  try {
    const install = await exchangeCode(code!);
    const result = await connectSlack(s.orgId, s.userId, install);
    if (result.error) message = result.error;
    else await audit(s.orgId, { userId: s.userId, name: s.name }, "integration.connect", `Slack: ${install.teamName} ${install.channel}`);
  } catch (err) {
    if (!(err instanceof SlackError)) console.error("slack install failed", err);
    message = err instanceof SlackError ? err.message : "Slack didn't finish connecting. Try again.";
  }
  back(message ? { slack: message } : { slackConnected: "1" });
}
