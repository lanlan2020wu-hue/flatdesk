// Funnel milestones and sign-up source. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { decodeSource, encodeSource, sourceFromVisit } from "./attribution";

process.env.VERCEL_WEB_ANALYTICS_DISABLE_LOGS = "1";

const ORG = "org_test_funnel";

after(async () => {
  const { pool } = await import("@/db");
  await pool.end();
});

test("a milestone is stamped once and leaves the rest of onboarding alone", async () => {
  const { db, schema } = await import("@/db");
  const { milestone } = await import("./funnel");
  const { updateOnboarding } = await import("./onboarding");

  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Funnel team", onboarding: { skipped: ["import"], source: { source: "google", at: "2026-10-01T00:00:00.000Z" } } });

  assert.equal(await milestone(ORG, "channel_connected", { channel: "email" }), true);
  const first = (await db.query.orgs.findFirst({ where: eq(schema.orgs.id, ORG) }))!.onboarding;
  const at = first.milestones?.channel_connected;
  assert.ok(at && !Number.isNaN(Date.parse(at)));
  assert.deepEqual(first.skipped, ["import"]);
  assert.equal(first.source?.source, "google");

  assert.equal(await milestone(ORG, "channel_connected", { channel: "chat" }), false, "repeats are no-ops");
  assert.equal(await milestone(ORG, "first_ai_answer"), true);
  // The checklist's own writes keep the milestones.
  await updateOnboarding(ORG, (ob) => ({ ...ob, dismissed: true }));
  const ob = (await db.query.orgs.findFirst({ where: eq(schema.orgs.id, ORG) }))!.onboarding;
  assert.equal(ob.milestones?.channel_connected, at);
  assert.ok(ob.milestones?.first_ai_answer);
  assert.equal(ob.dismissed, true);

  assert.equal(await milestone("org_missing", "card_added"), false);
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
});

test("the sign-up source comes from campaign tags, then the referring site", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  const url = (p: string) => new URL(p, "https://flatdesk.app");

  assert.deepEqual(sourceFromVisit(url("/pricing?utm_source=newsletter&utm_medium=email&utm_campaign=launch"), "https://mail.google.com/", false, now), {
    source: "newsletter",
    medium: "email",
    campaign: "launch",
    referrer: "mail.google.com",
    landing: "/pricing",
    at: now.toISOString(),
  });
  assert.equal(sourceFromVisit(url("/?ref=producthunt"), null, false, now)?.source, "producthunt");
  assert.equal(sourceFromVisit(url("/"), "https://www.reddit.com/r/saas", false, now)?.source, "reddit.com");
  assert.equal(sourceFromVisit(url("/"), "https://flatdesk.app/pricing", false, now)?.source, "direct", "our own pages aren't a referrer");
  assert.equal(sourceFromVisit(url("/"), "not a url", false, now)?.source, "direct");

  // The first visit wins unless a later one carries campaign tags.
  assert.equal(sourceFromVisit(url("/"), "https://news.ycombinator.com/", true, now), null);
  assert.equal(sourceFromVisit(url("/?utm_source=x"), null, true, now)?.source, "x");

  // The app and our customers' public pages aren't marketing traffic.
  for (const p of ["/app/welcome?utm_source=x", "/chat/abc?ref=x", "/help/acme", "/rate/1/good", "/api/waitlist"]) {
    assert.equal(sourceFromVisit(url(p), "https://acme.com/", false, now), null, p);
  }
});

test("the source cookie round-trips and rejects junk", () => {
  const s = { source: "newsletter", campaign: "launch", landing: "/", at: "2026-10-01T00:00:00.000Z" };
  assert.deepEqual(decodeSource(encodeSource(s)), s);
  assert.equal(decodeSource(undefined), null);
  assert.equal(decodeSource("{nope"), null);
  assert.equal(decodeSource(JSON.stringify({ campaign: "x" })), null);
  assert.equal(decodeSource(JSON.stringify({ source: "x".repeat(500), at: "t" }))?.source.length, 100);
});
