import { reconcileTeams } from "@/lib/agents";
import { dailyBilling } from "@/lib/billing";
import { cronAuthorized } from "@/lib/cron";
import { expireIdleImports } from "@/lib/import/engine";

// Called once a day by Vercel Cron (vercel.json).
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const expiredImports = await expireIdleImports();
  // Members removed in Clerk stop counting as seats before billing runs.
  const teams = await reconcileTeams({ budgetMs: 45_000 });
  return Response.json({ teams, billing: await dailyBilling(), expiredImports });
}
