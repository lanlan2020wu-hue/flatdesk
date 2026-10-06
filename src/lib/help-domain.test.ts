// The help center on a team's own domain and in more languages. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { isCustomHost, normalizeDomain } from "./domains";
import { helpUrl, localize } from "./help";
import { helpWords, pickLanguage } from "./help-i18n";
import { LANGUAGES } from "./language";

const ORG = "org_help_domain_test";

test("domains: tidy what people paste, refuse our own and odd ones", () => {
  assert.equal(normalizeDomain("https://Help.Acme.com/articles?x=1"), "help.acme.com");
  assert.equal(normalizeDomain("help.acme.co.uk."), "help.acme.co.uk");
  assert.equal(normalizeDomain("acme.com:443"), "acme.com");
  for (const bad of ["", "acme", "help..acme.com", "-x.acme.com", "1.2.3.4", "help acme.com", "x.vercel.app", "localhost", "a_b.acme.com"]) assert.equal(normalizeDomain(bad), null, bad);
  assert.equal(normalizeDomain("http://localhost:3000"), null);
});

test("domains: which request hosts are a team's help center", () => {
  assert.equal(isCustomHost("help.acme.com"), true);
  assert.equal(isCustomHost("Help.Acme.com:443"), true);
  for (const own of [null, "localhost:3000", "127.0.0.1:3005", "flatdesk-git-x.vercel.app", "10.0.0.1", "[::1]:3000"]) assert.equal(isCustomHost(own), false, String(own));
  assert.equal(helpUrl("acme-k3f9q2", "help.acme.com"), "https://help.acme.com");
  assert.match(helpUrl("acme-k3f9q2"), /\/help\/acme-k3f9q2$/);
});

test("languages: the address wins, then the browser, then the team's own", () => {
  const offered = ["en", "es", "de"];
  assert.equal(pickLanguage(offered, "de", "es"), "de");
  assert.equal(pickLanguage(offered, "fr", null), "en", "not offered");
  assert.equal(pickLanguage(offered, undefined, "fr-FR,fr;q=0.9,es;q=0.8,en;q=0.5"), "es");
  assert.equal(pickLanguage(offered, undefined, "en;q=0.2,de-AT;q=0.9"), "de");
  assert.equal(pickLanguage(offered, undefined, "es;q=0"), "en");
  assert.equal(pickLanguage(offered, undefined, "garbage;;q=x"), "en");
  // Every language the team can offer has the help center's own words.
  for (const l of LANGUAGES.filter((x) => x.code !== "en")) assert.notEqual(helpWords(l.code).heading, helpWords("en").heading, l.code);
});

test("localize: translated title and text where there is one", () => {
  const list = [{ id: "a", title: "Refunds", body: "How refunds work", section: "Billing" }, { id: "b", title: "Shipping", body: "Where it ships", section: null }];
  const at = new Date();
  const out = localize(list, new Map([["a", { id: "t", orgId: ORG, articleId: "a", language: "es", title: "Reembolsos", body: "Cómo funcionan", section: "Facturación", auto: true, sourceUpdatedAt: at, updatedAt: at }]]));
  assert.deepEqual(out.map((a) => [a.title, a.section, a.translated]), [["Reembolsos", "Facturación", true], ["Shipping", null, false]]);
});

test("database: found by its own domain, and searched in the visitor's language", { skip: !process.env.DATABASE_URL }, async () => {
  const { db, schema } = await import("@/db");
  const { orgByHelpSlug, searchTranslations, translationsFor } = await import("./help");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Domain team", inboundKey: "hdom00001", helpSlug: "domain-team-x2", helpDomain: "help.domainteam.test", helpLanguages: ["es"] });
  assert.equal((await orgByHelpSlug("help.domainteam.test"))?.id, ORG);
  assert.equal((await orgByHelpSlug("HELP.DOMAINTEAM.TEST"))?.id, ORG);
  assert.equal((await orgByHelpSlug("domain-team-x2"))?.id, ORG);
  assert.equal(await orgByHelpSlug("other.domainteam.test"), undefined);

  const now = new Date();
  const [live, draft] = await db
    .insert(schema.articles)
    .values([
      { orgId: ORG, slug: "refunds", title: "Refunds", body: "We refund within 5 days.", published: true },
      { orgId: ORG, slug: "secret", title: "Secret", body: "Not yet.", published: false },
    ])
    .returning();
  await db.insert(schema.articleTranslations).values([
    { orgId: ORG, articleId: live.id, language: "es", title: "Reembolsos", body: "Devolvemos el dinero en 5 días.", sourceUpdatedAt: now },
    { orgId: ORG, articleId: draft.id, language: "es", title: "Secreto", body: "Todavía no, reembolsos.", sourceUpdatedAt: now },
  ]);
  assert.deepEqual((await searchTranslations(ORG, "es", "reembolsos")).map((a) => a.slug), ["refunds"], "drafts stay hidden");
  assert.deepEqual((await searchTranslations(ORG, "es", "dinero")).map((a) => a.slug), ["refunds"]);
  assert.deepEqual(await searchTranslations(ORG, "de", "reembolsos"), []);
  assert.equal((await translationsFor(ORG, "es", [live.id])).get(live.id)?.title, "Reembolsos");

  // Deleting the article takes its translations with it.
  await db.delete(schema.articles).where(eq(schema.articles.id, live.id));
  assert.equal((await translationsFor(ORG, "es", [live.id])).size, 0);
});

after(async () => {
  if (!process.env.DATABASE_URL) return;
  const { db, schema, pool } = await import("@/db");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await pool.end();
});
