import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { db, schema } from "@/db";
import { clerkEnabled, devAuthEnabled } from "./auth-config";
import { linkImportedAgent } from "./import/link";

export type Session = {
  orgId: string;
  userId: string;
  role: "admin" | "agent";
  name: string;
};

const DEV_SESSION: Session = { orgId: "org_dev", userId: "user_dev", role: "admin", name: "Dev Agent" };

// Returns the signed-in agent and their org, creating local rows for them on
// first visit. Every page and action under /app calls this first.
export const requireSession = cache(async (): Promise<Session> => {
  await connection(); // always per-request, never prerendered
  if (devAuthEnabled) {
    await ensureRows(DEV_SESSION, "Demo Support Team", "dev@example.com");
    return DEV_SESSION;
  }
  // Before Clerk is connected, the app isn't open yet: send people to the waitlist.
  if (!clerkEnabled) redirect("/#waitlist");

  const { userId, orgId, orgRole } = await auth();
  if (!userId) redirect("/sign-in");
  if (!orgId) redirect("/setup");

  const user = await currentUser();
  const name = user?.fullName || user?.primaryEmailAddress?.emailAddress || "Agent";
  const session: Session = { orgId, userId, role: orgRole === "org:admin" ? "admin" : "agent", name };

  const existing = await db.query.agents.findFirst({
    where: and(eq(schema.agents.orgId, orgId), eq(schema.agents.userId, userId)),
  });
  if (!existing || existing.role !== session.role || existing.name !== name) {
    const org = await (await clerkClient()).organizations.getOrganization({ organizationId: orgId });
    await ensureRows(session, org.name, user?.primaryEmailAddress?.emailAddress ?? "");
  }
  return session;
});

export async function requireAdmin(): Promise<Session> {
  const session = await requireSession();
  if (session.role !== "admin") throw new Error("Only admins can do this.");
  return session;
}

async function ensureRows(session: Session, orgName: string, email: string) {
  await db.insert(schema.orgs).values({ id: session.orgId, name: orgName }).onConflictDoUpdate({
    target: schema.orgs.id,
    set: { name: orgName },
  });
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
