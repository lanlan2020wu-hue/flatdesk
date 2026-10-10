import { reconcileTeams } from "@/lib/agents";
import { dailyBilling } from "@/lib/billing";
import { runDueBackups } from "@/lib/backups";
import { sendDigests } from "@/lib/digest";
import { cronAuthorized } from "@/lib/cron";
import { expireIdleImports } from "@/lib/import/engine";
import { learnForAll } from "@/lib/learn";
import { purgeHelpSearches } from "@/lib/help-searches";
import { purgeTrash } from "@/lib/trash";
import { refreshSources } from "@/lib/web-knowledge";

// Called once a day by Vercel Cron (vercel.json).
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const expiredImports = await expireIdleImports();
  const purged = await purgeTrash();
  const searchesPurged = await purgeHelpSearches();
  // Members removed in Clerk stop counting as seats before billing runs.
  const teams = await reconcileTeams({ budgetMs: 45_000 });
  const billing = await dailyBilling();
  // Daily backups to teams' own storage, before the slower jobs use up the time.
  const backups = await runDueBackups(50_000);
  const digests = await sendDigests(20_000);
  // The AI learns from yesterday's solved tickets with what time is left.
  const learning = await learnForAll({ budgetMs: 130_000 });
  // Websites the AI reads are read again weekly.
  const websites = await refreshSources({ budgetMs: 60_000 });
  return Response.json({ teams, billing, backups, digests, expiredImports, learning, purged, searchesPurged, websites });
}
