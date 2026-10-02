// The /app audit: people removed from the team, duplicate rules, ids from
// forms, the overage cap and where alerts may be sent. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";

delete process.env.ALERTS_ALLOW_PRIVATE; // these tests check the address guard itself
process.env.INBOUND_DOMAIN = "in.flatdesk.test";

const ORG = "org_test_app_audit";

after(async () => {
  const { pool } = await import("@/db");
  await pool.end();
});

async function team() {
  const { db, schema } = await import("@/db");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Audit team", widgetKey: "auditwidget01", inboundKey: "audittest01", aiEnabled: false });
  await db.insert(schema.agents).values([
    { orgId: ORG, userId: "u_admin", name: "Ada", email: "ada@acme.com", role: "admin" },
    { orgId: ORG, userId: "u_stay", name: "Sam", email: "sam@acme.com", role: "agent" },
    { orgId: ORG, userId: "u_gone", name: "Gus", email: "gus@acme.com", role: "agent" },
  ]);
  return { db, schema };
}

test("someone removed from the team can't be assigned, isn't listed and isn't a seat", async () => {
  const { db, schema } = await team();
  const { markMembers, findAssignable } = await import("./agents");
  const { listAgents, createTicket } = await import("./tickets");
  const { seatCount } = await import("./billing");
  const { aiUsage } = await import("./ai");
  const { copilotUsage } = await import("./copilot");
  const { addRule } = await import("./rules");

  assert.equal(await seatCount(ORG), 3);
  const aiBefore = (await aiUsage(ORG)).included;
  const copilotBefore = (await copilotUsage(ORG)).limit;
  // A rule made while they were on the team.
  assert.equal(await addRule(ORG, "billing", "u_gone"), true);

  // An empty member list is never trusted.
  assert.deepEqual(await markMembers(ORG, []), { removed: 0, restored: 0 });
  assert.deepEqual(await markMembers(ORG, ["u_admin", "u_stay"]), { removed: 1, restored: 0 });

  assert.deepEqual((await listAgents(ORG)).map((a) => a.userId).sort(), ["u_admin", "u_stay"]);
  assert.equal(await findAssignable(ORG, "u_gone"), undefined);
  assert.equal((await findAssignable(ORG, "u_stay"))?.userId, "u_stay");
  assert.equal(await seatCount(ORG), 2);
  assert.equal((await aiUsage(ORG)).included, (aiBefore / 3) * 2);
  assert.equal((await copilotUsage(ORG)).limit, (copilotBefore / 3) * 2);

  // Their rule no longer hands them tickets, and a new one for them is refused.
  const base = { orgId: ORG, channel: "email" as const, customerEmail: "c@x.com", subject: "Invoice", body: "?", authorType: "customer" as const };
  assert.equal((await createTicket({ ...base, tags: ["billing"] })).assigneeId, null);
  assert.equal(await addRule(ORG, "refund", "u_gone"), false);

  // Back on the team: restored, and the rule works again.
  assert.deepEqual(await markMembers(ORG, ["u_admin", "u_stay", "u_gone"]), { removed: 0, restored: 1 });
  assert.equal((await createTicket({ ...base, tags: ["billing"] })).assigneeId, "u_gone");
  const gone = await db.query.agents.findFirst({ where: eq(schema.agents.userId, "u_gone") });
  assert.equal(gone?.removedAt, null);
});

test("the same rule added twice, even at once, is kept once", async () => {
  const { db, schema } = await team();
  const { addRule } = await import("./rules");
  await Promise.all([addRule(ORG, "vip", "u_stay"), addRule(ORG, "vip", "u_stay")]);
  assert.equal(await addRule(ORG, "vip", "u_stay"), true);
  const rows = await db.select().from(schema.rules).where(eq(schema.rules.orgId, ORG));
  assert.equal(rows.length, 1);
  // A tag and someone not on the team are both needed.
  assert.equal(await addRule(ORG, "", "u_stay"), false);
  assert.equal(await addRule(ORG, "vip", "u_nobody"), false);
});

test("form ids that aren't uuids are refused before Postgres sees them", async () => {
  const { isUuid } = await import("./ids");
  for (const bad of ["", "1", "abc", "0b7c3a52-4f7e-4c1e-9f55-2d1d8a1b2c3", "0b7c3a52-4f7e-4c1e-9f55-2d1d8a1b2c3d'--", "' or 1=1"]) assert.equal(isUuid(bad), false, bad);
  assert.equal(isUuid("0b7c3a52-4f7e-4c1e-9f55-2d1d8a1b2c3d"), true);
});

test("form input is bounded: overage cap, email, tag length", async () => {
  const { parseOverageLimit, validEmail } = await import("./app-input");
  assert.equal(parseOverageLimit(""), null);
  assert.equal(parseOverageLimit("0"), 0);
  assert.equal(parseOverageLimit(" 250 "), 250);
  assert.equal(parseOverageLimit("99999999999999"), 100_000);
  for (const bad of ["-1", "1.5", "1e9", "abc", "Infinity"]) assert.equal(parseOverageLimit(bad), null, bad);

  assert.equal(validEmail("sam@example.com"), true);
  for (const bad of ["sam", "sam@", "@x.com", "a b@x.com", "<sam@x.com>", `${"a".repeat(250)}@x.com`]) assert.equal(validEmail(bad), false, bad);

  const { normalizeTags } = await import("./tickets");
  assert.equal(normalizeTags(["x".repeat(500)])[0].length, 50);
});

test("alerts never reach a private address, however it's written", async () => {
  const { isPrivateAddress, publicLookup, postAlert } = await import("./alerts");
  const priv = [
    "127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "192.0.0.8", "0.0.0.0",
    "::", "::1", "fc00::1", "fd12::1", "fe80::1", "fec0::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::127.0.0.1", "0:0:0:0:0:ffff:10.0.0.1",
    "64:ff9b::127.0.0.1", "64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe", "64:ff9b:1::1",
    "2002:7f00:1::", "2002:c0a8:101::1", "2002:a9fe:a9fe::1", "2001:0:4136:e378::1",
    "not-an-ip",
  ];
  for (const ip of priv) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::1", "2a00:1450:4001::200e"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }

  // The name is checked at connect time, by the lookup the socket uses.
  const looked = await new Promise<Error | null>((resolve) => publicLookup("localhost", {}, (err) => resolve(err)));
  assert.match(looked?.message ?? "", /public server/);
  await assert.rejects(postAlert("https://localhost:9/hook", "{}", {}), /public server/);
  await assert.rejects(postAlert("https://127.0.0.1/hook", "{}", {}), /public server/);
  await assert.rejects(postAlert("https://[::ffff:7f00:1]/hook", "{}", {}), /public server/);
  await assert.rejects(postAlert("http://example.com/hook", "{}", {}), /https/);
});

test("test alerts are rate limited per team", async () => {
  const { db, schema } = await import("@/db");
  const { hit, LIMITS } = await import("./rate-limit");
  await db.delete(schema.rateLimits).where(eq(schema.rateLimits.key, `test-alert:${ORG}`));
  const results = [];
  for (let i = 0; i < 11; i++) results.push((await hit(LIMITS.testAlert(ORG))).ok);
  assert.deepEqual(results, [...Array(10).fill(true), false]);
});
