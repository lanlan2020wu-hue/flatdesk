// Help articles suggested in the chat widget while a visitor types.
// Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { matchWords } from "./help";

const ORG = "org_chat_articles_test";
const KEY = "chatarticles01";

test("matching skips greetings and filler, so the question's own words count", () => {
  assert.deepEqual(matchWords("Hello, I need help with my refund please"), ["with", "refund"]);
  assert.deepEqual(matchWords("hi ok"), []);
});

test("the widget suggests public articles, linked into the help center", async (t) => {
  if (!process.env.DATABASE_URL) return t.skip("needs DATABASE_URL");
  const { db, schema } = await import("@/db");
  const { GET } = await import("@/app/api/chat/[key]/articles/route");
  const ask = async (q: string, key = KEY) => {
    const r = await GET(new Request(`http://x/api/chat/${key}/articles?q=${encodeURIComponent(q)}`, { headers: { "x-forwarded-for": "198.51.100.23" } }), { params: Promise.resolve({ key }) });
    return { status: r.status, body: await r.json() };
  };
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Chat articles", widgetKey: KEY, inboundKey: "chatart001" });
  await db.insert(schema.articles).values([
    { orgId: ORG, slug: "refund-policy", title: "Refund policy", body: "Refunds within **30 days** of the order, to the original card.", published: true },
    { orgId: ORG, slug: "refund-override", title: "Refund override steps", body: "Supervisors can refund past 30 days.", published: true, internal: true },
    { orgId: ORG, slug: "refund-draft", title: "Refund draft", body: "Not ready.", published: false },
  ]);

  // No help center yet: nothing to link to.
  assert.deepEqual((await ask("Can I get a refund on my order?")).body, { articles: [] });

  await db.update(schema.orgs).set({ helpSlug: "chat-articles-x1" }).where(eq(schema.orgs.id, ORG));
  const { body } = await ask("Can I get a refund on my order?");
  assert.equal(body.articles.length, 1, "only published, public articles");
  assert.equal(body.articles[0].title, "Refund policy");
  assert.equal(body.articles[0].excerpt, "Refunds within 30 days of the order, to the original card.");
  assert.match(body.articles[0].url, /\/help\/chat-articles-x1\/refund-policy$/);

  // A verified custom domain is used for the link.
  await db.update(schema.orgs).set({ helpDomain: "help.chatarticles.test", helpDomainVerifiedAt: new Date() }).where(eq(schema.orgs.id, ORG));
  assert.equal((await ask("refund please")).body.articles[0].url, "https://help.chatarticles.test/refund-policy");

  assert.deepEqual((await ask("The app is slow today")).body, { articles: [] });
  assert.deepEqual((await ask("hi")).body, { articles: [] });
  assert.equal((await ask("refund", "nosuchwidget1")).status, 404);
});

after(async () => {
  if (!process.env.DATABASE_URL) return;
  const { db, schema, pool } = await import("@/db");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await pool.end();
});
