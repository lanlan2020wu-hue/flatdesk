import { auth } from "@clerk/nextjs/server";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { clerkEnabled, devAuthEnabled } from "@/lib/auth-config";
import { alertsSince } from "@/lib/browser-alerts";

// Asked every half minute by an open Flatdesk tab whose person turned on
// browser alerts (components/BrowserAlerts.tsx). Like the presence heartbeat,
// it only reads the session token and the agent's row.
export async function GET(request: Request) {
  let orgId: string | null = null;
  let userId: string | null = null;
  if (devAuthEnabled) {
    orgId = "org_dev";
    userId = "user_dev";
  } else if (clerkEnabled) {
    const a = await auth();
    orgId = a.orgId ?? null;
    userId = a.userId;
  }
  if (!orgId || !userId) return Response.json({ error: "Sign in again." }, { status: 401 });
  const agent = await db.query.agents.findFirst({ where: and(eq(schema.agents.orgId, orgId), eq(schema.agents.userId, userId), isNull(schema.agents.removedAt)) });
  if (!agent) return Response.json({ error: "Not on this team." }, { status: 403 });

  const raw = new URL(request.url).searchParams.get("since");
  const since = raw && /^\d{13}$/.test(raw) ? new Date(Number(raw)) : null;
  const out = await alertsSince(orgId, userId, agent.viewer ? null : since);
  return Response.json(out, { headers: { "cache-control": "no-store" } });
}
