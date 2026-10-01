import { track } from "@vercel/analytics/server";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Milestone } from "@/db/schema";

// The trial funnel, from team created to card added. Page views (landing,
// /sign-up, /setup) come from <Analytics /> in the root layout; everything
// after that is a milestone recorded here.
//
// The first time a team reaches a milestone it's stamped in
// orgs.onboarding.milestones, so the funnel can be read straight from the
// database, and sent to Vercel Web Analytics as a custom event. Repeats are
// no-ops, so callers can mark a milestone every time the thing happens.

const EVENT: Record<Milestone, string> = {
  team_created: "Team created",
  agent_invited: "Agent invited",
  forwarding_confirmed: "Forwarding confirmed",
  test_email_sent: "Test email sent",
  sample_ticket_created: "Sample ticket created",
  skipped_invite: "Setup step skipped",
  skipped_inbox: "Setup step skipped",
  skipped_import: "Setup step skipped",
  skipped_test: "Setup step skipped",
  onboarding_dismissed: "Setup checklist hidden",
  channel_connected: "Channel connected",
  first_customer_ticket: "First customer ticket",
  import_started: "Import started",
  test_drive_started: "Test drive started",
  first_ai_answer: "First AI answer",
  card_added: "Card added",
};

type Props = Record<string, string | number | boolean | null | undefined>;

// Never throws: measuring must not break the thing being measured.
export async function milestone(orgId: string, key: Milestone, props?: Props) {
  try {
    const stamped = await db
      .update(schema.orgs)
      .set({
        onboarding: sql`${schema.orgs.onboarding} || jsonb_build_object('milestones', coalesce(${schema.orgs.onboarding} -> 'milestones', '{}'::jsonb) || jsonb_build_object(${key}::text, ${new Date().toISOString()}::text))`,
      })
      .where(and(eq(schema.orgs.id, orgId), sql`${schema.orgs.onboarding} -> 'milestones' ->> ${key}::text is null`))
      .returning({ id: schema.orgs.id });
    if (!stamped.length) return false;
    const step = key.startsWith("skipped_") ? { step: key.slice("skipped_".length) } : {};
    await track(EVENT[key], { ...step, ...props });
    return true;
  } catch (err) {
    console.error(`funnel milestone ${key} failed`, err);
    return false;
  }
}
