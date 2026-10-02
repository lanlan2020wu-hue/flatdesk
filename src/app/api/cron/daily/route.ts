import { createHash, timingSafeEqual } from "node:crypto";
import { reconcileTeams } from "@/lib/agents";
import { dailyBilling } from "@/lib/billing";
import { expireIdleImports } from "@/lib/import/engine";

// Called once a day by Vercel Cron (vercel.json). Vercel sends CRON_SECRET as
// a bearer token; anything else is refused.
export const maxDuration = 300;

// Compared in constant time. Hashing first gives both sides the same length.
function authorized(header: string | null, secret: string | undefined) {
  if (!secret || !header) return false;
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

export async function GET(request: Request) {
  if (!authorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const expiredImports = await expireIdleImports();
  // Members removed in Clerk stop counting as seats before billing runs.
  const teams = await reconcileTeams({ budgetMs: 45_000 });
  return Response.json({ teams, billing: await dailyBilling(), expiredImports });
}
