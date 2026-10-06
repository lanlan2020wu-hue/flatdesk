import { auth } from "@clerk/nextjs/server";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { clerkEnabled, devAuthEnabled } from "@/lib/auth-config";
import { isUuid } from "@/lib/ids";
import { leaveTicket, reportPresence, sweepPresence } from "@/lib/presence";

// The ticket page's heartbeat (components/TicketPresence.tsx). Called every
// few seconds per open ticket, so it only reads the session token and the
// agent's row, not the full sign-in check pages do.
export async function POST(request: Request) {
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

  const body = (await request.json().catch(() => null)) as { ticketId?: unknown; typing?: unknown; leaving?: unknown } | null;
  if (!body || !isUuid(body.ticketId)) return Response.json({ error: "Bad request." }, { status: 400 });
  if (body.leaving === true) {
    await leaveTicket(orgId, userId, body.ticketId);
    return new Response(null, { status: 204 });
  }
  const out = await reportPresence(orgId, userId, agent.name, body.ticketId, body.typing === true && !agent.viewer);
  if (!out) return Response.json({ error: "No such ticket." }, { status: 404 });
  if (Math.random() < 0.01) await sweepPresence();
  return Response.json(out);
}
