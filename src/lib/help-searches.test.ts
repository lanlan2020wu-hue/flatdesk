// The help center's search report. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq, like } from "drizzle-orm";
import { normalizeQuery } from "./help-searches";

const ORG = "org_test_help_searches";

test("searches are counted together and ones with someone's details aren't kept", () => {
  assert.equal(normalizeQuery("  Refund?  "), "refund");
  assert.equal(normalizeQuery("How do I   cancel, my plan!"), "how do i cancel my plan");
  assert.equal(normalizeQuery("x"), null);
  assert.equal(normalizeQuery("order for kim@example.com"), null);
  assert.equal(normalizeQuery("order 123-456-7890"), null);
  assert.equal(normalizeQuery("iphone 15 case"), "iphone 15 case");
});

if (process.env.DATABASE_URL) {
  after(async () => {
    const { db, schema, pool } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await pool.end();
  });

  test("database: the report shows top searches and the ones that still find nothing", async () => {
    const { db, schema } = await import("@/db");
    const { helpSearchReport, logHelpSearch, purgeHelpSearches, HELP_SEARCH_DAYS } = await import("./help-searches");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await db.insert(schema.orgs).values({ id: ORG, name: "Acme", inboundKey: "hsearch001" });
    await db.delete(schema.rateLimits).where(like(schema.rateLimits.key, "help-search:%"));

    await logHelpSearch(ORG, "Refund", 2, "ip-a");
    await logHelpSearch(ORG, "refund?", 2, "ip-b");
    await logHelpSearch(ORG, "Gift cards", 0, "ip-a");
    await logHelpSearch(ORG, "gift cards", 0, "ip-c");
    await logHelpSearch(ORG, "wholesale", 0, "ip-a");
    await logHelpSearch(ORG, "my email is kim@example.com", 0, "ip-a");
    // Once an article answers it, it's no longer a miss.
    await logHelpSearch(ORG, "wholesale", 1, "ip-b");

    const r = await helpSearchReport(ORG);
    assert.equal(r.total, 6);
    assert.equal(r.empty, 3);
    assert.deepEqual(r.top.slice(0, 3).map((t) => [t.query, t.searches]), [["gift cards", 2], ["refund", 2], ["wholesale", 2]]);
    assert.deepEqual(r.misses.map((m) => [m.query, m.searches]), [["gift cards", 2]]);

    // One visitor can't fill the report.
    for (let i = 0; i < 40; i++) await logHelpSearch(ORG, `spam ${i}`, 0, "ip-spam");
    // (Other test files clear rate limits while running, so not an exact count.)
    assert.ok((await helpSearchReport(ORG)).total < 6 + 40);

    await db.update(schema.helpSearches).set({ createdAt: new Date(Date.now() - (HELP_SEARCH_DAYS + 1) * 86_400_000) }).where(eq(schema.helpSearches.query, "refund"));
    assert.ok((await purgeHelpSearches()) >= 2);
    assert.equal((await helpSearchReport(ORG)).top.find((t) => t.query === "refund"), undefined);
  });
}
