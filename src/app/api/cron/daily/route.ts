import { dailyBilling } from "@/lib/billing";

// Called once a day by Vercel Cron (vercel.json). Vercel sends CRON_SECRET as
// a bearer token; anything else is refused.
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({ billing: await dailyBilling() });
}
