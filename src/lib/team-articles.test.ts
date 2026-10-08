// Team-only help articles: never public or seen by the customer-facing AI.
// Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";

const ORG = "org_team_articles_test";

test("team-only articles stay off the help center and out of the customer AI", async (t) => {
  if (!process.env.DATABASE_URL) return t.skip("needs DATABASE_URL");
  const { db, schema } = await import("@/db");
  const help = await import("./help");
  const { loadKnowledge } = await import("./ai");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Team articles", inboundKey: "tart00001", helpSlug: "team-articles-x2", helpLanguages: ["es"] });
  const [pub, team] = await db
    .insert(schema.articles)
    .values([
      { orgId: ORG, slug: "refund-policy", title: "Refund policy", body: "Refunds within 30 days of the order.", published: true },
      { orgId: ORG, slug: "refund-override", title: "Refund override steps", body: "Supervisors can refund past 30 days in the billing console.", published: true, internal: true },
    ])
    .returning();
  await db.insert(schema.articleTranslations).values({ orgId: ORG, articleId: team.id, language: "es", title: "Anulación de reembolso", body: "Pasos internos", sourceUpdatedAt: new Date() });

  assert.deepEqual((await help.publishedArticles(ORG)).map((a) => a.id), [pub.id]);
  assert.equal(await help.publishedArticle(ORG, "refund-override"), undefined);
  assert.deepEqual((await help.searchArticles(ORG, "refund")).map((a) => a.id), [pub.id]);
  assert.deepEqual(await help.searchTranslations(ORG, "es", "reembolso"), []);

  const customerAi = await loadKnowledge(ORG);
  assert.ok(customerAi.some((k) => k.name === "Refund policy"));
  assert.ok(!customerAi.some((k) => /override/i.test(k.name) || /billing console/.test(k.body)), "the AI answering customers never sees team-only text");

  const drafts = await loadKnowledge(ORG, { team: true });
  const internal = drafts.find((k) => k.name.startsWith("Refund override steps"));
  assert.ok(internal, "agent drafts use it");
  assert.match(internal.name, /team only/);
  assert.doesNotMatch(internal.body, /Help center article:/, "no public link to give out");

  // Beside a ticket: both kinds, matched on any of the ticket's words.
  const related = await help.articlesForTicket(ORG, "Can I get a refund? My order is 45 days old");
  assert.deepEqual(new Set(related.map((a) => a.id)), new Set([pub.id, team.id]));
  assert.equal(related.find((a) => a.id === team.id)?.internal, true);
  assert.deepEqual(await help.articlesForTicket(ORG, "Hi there, the app is slow"), []);
  assert.deepEqual(await help.articlesForTicket(ORG, "ok"), []);
});

after(async () => {
  if (!process.env.DATABASE_URL) return;
  const { db, schema, pool } = await import("@/db");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await pool.end();
});
