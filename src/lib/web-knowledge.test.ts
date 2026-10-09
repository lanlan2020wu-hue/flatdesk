// Websites the AI reads. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { checkSiteUrl, inScope, readHtml, readSite, robotsAllow, robotsRules, WEB } from "./web-knowledge";

process.env.ALERTS_ALLOW_PRIVATE = "1"; // the fake site listens on 127.0.0.1 (read when a request is made)

const ORG = "org_test_web";
const words = (topic: string) => `${topic} `.repeat(60);
const page = (title: string, body: string, links: string[] = []) =>
  `<!doctype html><html><head><title>${title}</title><script>var x = "<p>not text</p>";</script></head><body><nav><a href="/docs/shipping">Shipping</a> Menu menu</nav><main><h1>${title}</h1><p>${body}</p>${links.map((l) => `<a href="${l}">more</a>`).join("")}</main><footer>© Acme</footer></body></html>`;
const SITE: Record<string, { type?: string; body: string; status?: number; location?: string }> = {
  "/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /docs/private\n" },
  "/sitemap.xml": { type: "application/xml", body: "<urlset><url><loc>BASE/docs/returns</loc></url><url><loc>BASE/blog/news</loc></url></urlset>" },
  "/docs": { body: page("Docs home", words("welcome"), ["/docs/private/secret", "/docs/moved", "https://elsewhere.example/docs/x", "/pricing"]) },
  "/docs/shipping": { body: page("Shipping", words("We ship from Portland within 2 business days.")) },
  "/docs/returns": { body: page("Returns &amp; refunds", words("Returns are free for 30 days.")) },
  "/docs/private/secret": { body: page("Secret", words("hidden")) },
  "/docs/moved": { status: 301, location: "/docs/shipping", body: "" },
  "/blog/news": { body: page("News", words("news")) },
  "/pricing": { body: page("Pricing", words("price")) },
};
const served: string[] = [];
const server = createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  served.push(path);
  const hit = SITE[path];
  if (!hit) return res.writeHead(404).end("not found");
  if (hit.location) return res.writeHead(hit.status ?? 301, { location: hit.location }).end();
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  res.writeHead(hit.status ?? 200, { "content-type": hit.type ?? "text/html; charset=utf-8" }).end(hit.body.replaceAll("BASE", base));
});
let base = "";
before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test("addresses are normalized, and private or odd ones are refused", () => {
  delete process.env.ALERTS_ALLOW_PRIVATE;
  try {
    assert.deepEqual(checkSiteUrl("acme.com/docs/"), { url: "https://acme.com/docs" });
    assert.deepEqual(checkSiteUrl("https://acme.com/?utm=1#top"), { url: "https://acme.com" });
    assert.ok("error" in checkSiteUrl("http://acme.com"));
    assert.ok("error" in checkSiteUrl("https://127.0.0.1/docs"));
    assert.ok("error" in checkSiteUrl("https://intranet/docs"));
    assert.ok("error" in checkSiteUrl("https://me:pw@acme.com"));
    assert.ok("error" in checkSiteUrl(""));
  } finally {
    process.env.ALERTS_ALLOW_PRIVATE = "1";
  }
});

test("pages keep their main text, not scripts or navigation, and every link", () => {
  const r = readHtml(page("Returns &amp; refunds", "Free for <b>30 days</b>.", ["/docs/a"]), "https://acme.com/docs");
  assert.equal(r.title, "Returns & refunds");
  assert.match(r.text, /Free for 30 days\./);
  assert.doesNotMatch(r.text, /not text|Menu|© Acme/);
  assert.deepEqual(r.links, ["https://acme.com/docs/shipping", "https://acme.com/docs/a"]);
});

test("only links under the address are followed", () => {
  assert.equal(inScope("https://www.acme.com/docs/a?x=1#y", "https://acme.com/docs"), "https://acme.com/docs/a");
  assert.equal(inScope("https://acme.com/docsmore", "https://acme.com/docs"), null);
  assert.equal(inScope("https://acme.com/pricing", "https://acme.com/docs"), null);
  assert.equal(inScope("https://acme.com/pricing", "https://acme.com"), "https://acme.com/pricing");
  assert.equal(inScope("https://acme.com/docs/guide.pdf", "https://acme.com/docs"), null);
  assert.equal(inScope("https://other.com/docs/a", "https://acme.com/docs"), null);
});

test("robots.txt rules for everyone or for FlatdeskBot are respected", () => {
  const rules = robotsRules("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\nAllow: /admin/help\n");
  assert.ok(robotsAllow(rules, "/docs"));
  assert.ok(!robotsAllow(rules, "/admin/users"));
  assert.ok(robotsAllow(rules, "/admin/help/x"));
  assert.ok(!robotsAllow(robotsRules("User-agent: FlatdeskBot\nDisallow: /\n"), "/anything"));
});

test("reading a site: the address, its sitemap pages and links under it, minus robots.txt and duplicates", async () => {
  const pages = await readSite(`${base}/docs`, 20_000);
  const paths = pages.map((p) => new URL(p.url).pathname).sort();
  assert.deepEqual(paths, ["/docs", "/docs/returns", "/docs/shipping"]);
  assert.ok(!served.includes("/docs/private/secret"), "robots.txt is respected");
  assert.ok(!served.includes("/blog/news") && !served.includes("/pricing"), "nothing outside the address is fetched");
  const returns = pages.find((p) => p.url.endsWith("/docs/returns"));
  assert.equal(returns?.title, "Returns & refunds");
  assert.ok(pages.every((p) => p.text.length <= WEB.pageChars));
});

after(() => server.close());

if (process.env.DATABASE_URL) {
  after(async () => {
    const { db, schema, pool } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await pool.end();
  });

  test("database: a team's website becomes knowledge the AI reads, after its own saved answers", async () => {
    const { db, schema } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await db.insert(schema.orgs).values({ id: ORG, name: "Acme" });
    await db.insert(schema.macros).values({ orgId: ORG, name: "Hours", body: "We're open 9 to 5." });
    const { addSource, readSource, markReading, removeSource, WebSourceError } = await import("./web-knowledge");
    const { loadKnowledge } = await import("./ai");

    const source = await addSource(ORG, `${base}/docs/`);
    assert.equal(source.url, `${base}/docs`);
    await assert.rejects(addSource(ORG, `${base}/docs`), WebSourceError, "no duplicates");
    assert.equal(await readSource(ORG, source.id, 20_000), 3);
    const row = await db.query.webSources.findFirst({ where: eq(schema.webSources.id, source.id) });
    assert.equal(row?.status, "ready");
    assert.equal(row?.pageCount, 3);
    assert.equal(await markReading(ORG, source.id), false, "not read again within minutes");

    const knowledge = await loadKnowledge(ORG);
    assert.equal(knowledge[0].name, "Hours");
    const shipping = knowledge.find((k) => k.name === "Shipping (from your website)");
    assert.match(shipping?.body ?? "", /Portland/);
    assert.match(shipping?.body ?? "", new RegExp(`Page: ${base}/docs/shipping$`));

    // Reading again replaces the pages; removing the address removes them.
    assert.equal(await readSource(ORG, source.id, 20_000), 3);
    assert.equal((await db.select().from(schema.webPages).where(eq(schema.webPages.orgId, ORG))).length, 3);
    await removeSource(ORG, source.id);
    assert.equal((await db.select().from(schema.webPages).where(eq(schema.webPages.orgId, ORG))).length, 0);

    const empty = await addSource(ORG, `${base}/nothing`);
    assert.equal(await readSource(ORG, empty.id, 5_000), 0);
    assert.equal((await db.query.webSources.findFirst({ where: eq(schema.webSources.id, empty.id) }))?.status, "failed");
  });
}
