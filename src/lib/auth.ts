import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { and, eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after, connection } from "next/server";
import { cache } from "react";
import { db, schema } from "@/db";
import { decodeSource, SOURCE_COOKIE } from "@/lib/attribution";
import { syncSeats } from "@/lib/billing";
import { milestone } from "@/lib/funnel";
import { clerkEnabled, devAuthEnabled } from "./auth-config";
import { linkImportedAgent } from "./import/link";

export type Session = {
  orgId: string;
  userId: string;
  role: "admin" | "agent";
  name: string;
  viewer: boolean; // reads everything, changes nothing, isn't billed
};

const DEV_SESSION: Session = { orgId: "org_dev", userId: "user_dev", role: "admin", name: "Dev Agent", viewer: false };

// Returns the signed-in agent and their org, creating local rows for them on
// first visit. Every page and action under /app calls this first.
export const requireSession = cache(async (): Promise<Session> => {
  await connection(); // always per-request, never prerendered
  if (devAuthEnabled) {
    await ensureRows(DEV_SESSION, "Demo Support Team", "dev@example.com");
    return DEV_SESSION;
  }
  // Before Clerk is connected, the app isn't open yet: send people to the design-partner form.
  if (!clerkEnabled) redirect("/#partner");

  const { userId, orgId, orgRole } = await auth();
  if (!userId) redirect("/sign-in");
  if (!orgId) redirect("/setup");

  const user = await currentUser();
  const name = user?.fullName || user?.primaryEmailAddress?.emailAddress || "Agent";
  const role = orgRole === "org:admin" ? "admin" : "agent";
  const existing = await db.query.agents.findFirst({
    where: and(eq(schema.agents.orgId, orgId), eq(schema.agents.userId, userId)),
  });
  const session: Session = { orgId, userId, role, name, viewer: role === "agent" && Boolean(existing?.viewer) };
  if (!existing || existing.role !== session.role || existing.name !== name) {
    const org = await (await clerkClient()).organizations.getOrganization({ organizationId: orgId });
    await ensureRows(session, org.name, user?.primaryEmailAddress?.emailAddress ?? "");
    if (!existing) after(() => syncSeats(orgId).catch((err) => console.error("seat sync failed", err)));
  }
  return session;
});

// For anything that changes tickets, macros or replies.
export async function requireEditor(): Promise<Session> {
  const session = await requireSession();
  if (session.viewer) throw new Error("You have a viewer seat, so you can read tickets but not change them. An admin can make you an agent in Settings.");
  return session;
}

export async function requireAdmin(): Promise<Session> {
  const session = await requireSession();
  if (session.role !== "admin") throw new Error("Only admins can do this.");
  return session;
}

async function ensureRows(session: Session, orgName: string, email: string) {
  // A new team keeps where its creator came from (lib/attribution.ts).
  const source = decodeSource((await cookies()).get(SOURCE_COOKIE)?.value);
  const [org] = await db
    .insert(schema.orgs)
    .values({ id: session.orgId, name: orgName, onboarding: source ? { source } : {} })
    .onConflictDoUpdate({ target: schema.orgs.id, set: { name: orgName } })
    .returning({ created: sql<boolean>`xmax = 0` }); // true when the row was inserted, not updated
  if (org?.created) await milestone(session.orgId, "team_created", { source: source?.source ?? "direct", campaign: source?.campaign });
  await db
    .insert(schema.agents)
    .values({ orgId: session.orgId, userId: session.userId, name: session.name, email, role: session.role })
    .onConflictDoUpdate({
      target: [schema.agents.orgId, schema.agents.userId],
      set: { name: session.name, role: session.role, ...(email ? { email } : {}) },
    });
  // Tickets and rules imported from the team's old help desk wait for their agent by email.
  if (email) await linkImportedAgent(session.orgId, session.userId, email);
}
