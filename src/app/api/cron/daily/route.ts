import { reconcileTeams } from "@/lib/agents";
import { dailyBilling } from "@/lib/billing";
import { cronAuthorized } from "@/lib/cron";
import { expireIdleImports } from "@/lib/import/engine";
import { learnForAll } from "@/lib/learn";
import { purgeHelpSearches } from "@/lib/help-searches";
import { purgeTrash } from "@/lib/trash";

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
  // The AI learns from yesterday's solved tickets with what time is left.
  const learning = await learnForAll({ budgetMs: 150_000 });
  return Response.json({ teams, billing, expiredImports, learning, purged, searchesPurged });
}
