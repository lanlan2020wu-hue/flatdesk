// Help center: article text, addresses, search and what the AI reads. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { excerpt, parseArticle, parseInline, plainText, slugify, validHelpSlug } from "@/lib/help";

const ORG = "org_test_help";
const OTHER = "org_test_help_2";

after(async () => {
  const { db, schema, pool } = await import("@/db");
  for (const id of [ORG, OTHER]) await db.delete(schema.orgs).where(eq(schema.orgs.id, id));
  await pool.end();
});

test("slugify makes readable, safe addresses", () => {
  assert.equal(slugify("Reset your password"), "reset-your-password");
  assert.equal(slugify("  Refunds & returns!! "), "refunds-and-returns");
  assert.equal(slugify("Café crème"), "cafe-creme");
  assert.equal(slugify("???"), "article");
  assert.ok(slugify("x".repeat(200)).length <= 60);
  assert.ok(validHelpSlug("acme-support"));
  assert.ok(!validHelpSlug("ab"));
  assert.ok(!validHelpSlug("-acme"));
  assert.ok(!validHelpSlug("acme--help"));
  assert.ok(!validHelpSlug("Acme"));
});

test("articles parse headings, lists, bold and links", () => {
  const blocks = parseArticle(
    "If you forgot it, reset it.\nIt takes a minute.\n\n## Steps\n1. Click **Forgot password**.\n2. Open the email.\n   It works for 1 hour.\n\n- Check spam\n* Check the address\n\nSee [our guide](https://example.com/a) or <script>alert(1)</script>.",
  );
  assert.deepEqual(blocks.map((b) => b.type), ["paragraph", "heading", "list", "list", "paragraph"]);
  assert.deepEqual(blocks[0], { type: "paragraph", content: [{ type: "text", text: "If you forgot it, reset it. It takes a minute." }] });
  const steps = blocks[2];
  assert.ok(steps.type === "list" && steps.ordered && steps.items.length === 2);
  assert.deepEqual(steps.items[0], [
    { type: "text", text: "Click " },
    { type: "bold", text: "Forgot password" },
    { type: "text", text: "." },
  ]);
  assert.deepEqual(steps.items[1], [{ type: "text", text: "Open the email. It works for 1 hour." }]);
  const bullets = blocks[3];
  assert.ok(bullets.type === "list" && !bullets.ordered && bullets.items.length === 2);
  const last = blocks[4];
  assert.ok(last.type === "paragraph");
  assert.deepEqual(last.content[1], { type: "link", text: "our guide", href: "https://example.com/a" });
  // Markup that isn't one of ours stays text, which React escapes.
  assert.equal(last.content[2].type, "text");
  assert.match((last.content[2] as { text: string }).text, /<script>/);
});

test("only http, https and mailto links become links", () => {
  assert.deepEqual(parseInline("[x](javascript:alert(1))"), [{ type: "text", text: "[x](javascript:alert(1))" }]);
  assert.equal(parseInline("[mail](mailto:help@acme.com)")[0].type, "link");
});

test("plain text and excerpts drop the markup", () => {
  const body = "Intro line.\n\n## Steps\n1. Do **this**.\n2. Then [that](https://a.co).";
  assert.equal(plainText(body), "Intro line.\n\nSteps\n\n1. Do this.\n2. Then that (https://a.co).");
  assert.equal(excerpt(body), "Intro line. Steps Do this. Then that.");
  const long = excerpt("word ".repeat(100), 40);
  assert.ok(long.length <= 41 && long.endsWith("…"));
});

test("help center addresses, search and AI knowledge", async () => {
  const { db, schema } = await import("@/db");
  const { ensureHelpSlug, searchArticles, uniqueArticleSlug, articleKnowledge } = await import("@/lib/help");
  const { loadKnowledge } = await import("@/lib/ai");
  for (const id of [ORG, OTHER]) await db.delete(schema.orgs).where(eq(schema.orgs.id, id));
  await db.insert(schema.orgs).values([
    { id: ORG, name: "Help Test Co", inboundKey: "helptest01", widgetKey: "helpwidget01" },
    { id: OTHER, name: "Help Test Co", inboundKey: "helptest02", widgetKey: "helpwidget02" },
  ]);

  // Same name, clearly different addresses that can't be guessed from the name; asking twice keeps the first.
  const a = await ensureHelpSlug(ORG);
  const b = await ensureHelpSlug(OTHER);
  assert.match(a, /^help-test-co-[a-z2-9]{6}$/);
  assert.match(b, /^help-test-co-[a-z2-9]{6}$/);
  assert.notEqual(a, b);
  assert.ok(validHelpSlug(a) && validHelpSlug(b));
  assert.equal(await ensureHelpSlug(ORG), a);

  await db.insert(schema.articles).values([
    { orgId: ORG, slug: "refunds-and-returns", title: "Refunds and returns", body: "We refund any order within 30 days.", published: true },
    { orgId: ORG, slug: "shipping-times", title: "Shipping times", body: "Orders ship within 2 business days. Refunds for late orders are automatic.", published: true },
    { orgId: ORG, slug: "secret-draft", title: "Refund exceptions", body: "Internal: we sometimes refund after 30 days.", published: false },
    { orgId: OTHER, slug: "refunds", title: "Refunds", body: "Another team's refund policy.", published: true },
  ]);
  assert.equal(await uniqueArticleSlug(ORG, "Shipping times"), "shipping-times-2");
  assert.equal(await uniqueArticleSlug(ORG, "Gift cards"), "gift-cards");

  // Stemming finds "refund" for "refunds"; title matches come first; drafts and other teams never show.
  const hits = await searchArticles(ORG, "refunds");
  assert.deepEqual(hits.map((h) => h.title), ["Refunds and returns", "Shipping times"]);
  assert.deepEqual((await searchArticles(ORG, "ship")).map((h) => h.title), ["Shipping times"]);
  assert.deepEqual(await searchArticles(ORG, "100%_"), []);
  assert.deepEqual(await searchArticles(ORG, "   "), []);

  // The AI reads published articles with their public link, next to macros.
  await db.insert(schema.macros).values({ orgId: ORG, name: "Greeting", body: "Hi there" });
  const kb = await articleKnowledge(ORG);
  assert.equal(kb.length, 2);
  assert.ok(kb.every((k) => k.name !== "Refund exceptions"));
  assert.match(kb.find((k) => k.name === "Shipping times")!.body, /Help center article: https?:\/\/.+\/help\/help-test-co-[a-z2-9]{6}\/shipping-times$/);
  const all = await loadKnowledge(ORG);
  assert.deepEqual(all.map((k) => k.name).sort(), ["Greeting", "Refunds and returns", "Shipping times"]);
});

test("imported article HTML keeps headings, lists, bold and safe links", async () => {
  const { htmlToArticle, parseArticle } = await import("./help");
  const out = htmlToArticle('<h3>Steps</h3><ul><li>One &amp; two</li></ul><p><a href="javascript:alert(1)">bad</a> <a href="https://ok.com">good</a><br>next&nbsp;line</p><script>x()</script>');
  assert.equal(out, "### Steps\n\n- One & two\n\nbad [good](https://ok.com)\nnext line");
  // What it produces reads back as the same blocks the help center renders.
  assert.deepEqual(parseArticle(out).map((b) => b.type), ["heading", "list", "paragraph"]);
});

