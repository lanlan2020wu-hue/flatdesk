// Help center categories. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { categorySlug, groupByCategory } from "./help-sections";

const ORG = "org_test_categories";

test("articles group by category in the team's order, the rest by name, uncategorized last", () => {
  const list = [{ section: "Billing", t: 1 }, { section: null, t: 2 }, { section: "Account", t: 3 }, { section: "Billing ", t: 4 }, { section: "Shipping", t: 5 }];
  assert.deepEqual(groupByCategory(list, []).map((g) => [g.section, g.articles.map((a) => a.t)]), [["Account", [3]], ["Billing", [1, 4]], ["Shipping", [5]], [null, [2]]]);
  assert.deepEqual(groupByCategory(list, ["Shipping", "Billing"]).map((g) => g.section), ["Shipping", "Billing", "Account", null]);
});

test("category links have readable slugs", () => {
  assert.equal(categorySlug("Billing & plans"), "billing-plans");
  assert.equal(categorySlug("Café pagos"), "cafe-pagos");
  assert.equal(categorySlug("配送"), "配送");
  assert.equal(categorySlug("!!!"), "category");
});

if (process.env.DATABASE_URL) {
  after(async () => {
    const { db, schema, pool } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await pool.end();
  });

  test("database: order, describe and rename categories", async () => {
    const { db, schema } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await db.insert(schema.orgs).values({ id: ORG, name: "Shop" });
    const { categoryOrder, listCategories, moveCategory, saveCategory, CategoryError } = await import("./help-sections");
    const mk = (title: string, section: string | null) => ({ orgId: ORG, slug: title.toLowerCase().replace(/\W+/g, "-"), title, body: "x", section, published: true });
    await db.insert(schema.articles).values([mk("Refunds", "Billing"), mk("Invoices", "Billing"), mk("Tracking", "Shipping"), mk("Password", "Account"), mk("Hello", null)]);

    assert.deepEqual((await listCategories(ORG)).map((c) => [c.name, c.articles]), [["Account", 1], ["Billing", 2], ["Shipping", 1]]);
    await moveCategory(ORG, "Shipping", "up");
    await moveCategory(ORG, "Shipping", "up");
    assert.deepEqual((await listCategories(ORG)).map((c) => c.name), ["Shipping", "Account", "Billing"]);

    await saveCategory(ORG, { name: "Billing", newName: "Billing  & plans ", description: "Invoices, refunds and changing plans." });
    const cats = await listCategories(ORG);
    assert.deepEqual(cats.map((c) => c.name), ["Shipping", "Account", "Billing & plans"], "keeps its place after a rename");
    assert.equal(cats[2].description, "Invoices, refunds and changing plans.");
    assert.equal(cats[2].articles, 2, "the articles moved with it");
    assert.equal((await categoryOrder(ORG)).descriptions.get("Billing & plans"), "Invoices, refunds and changing plans.");

    // Renaming onto another category merges them.
    await saveCategory(ORG, { name: "Account", newName: "Shipping", description: "" });
    assert.deepEqual((await listCategories(ORG)).map((c) => [c.name, c.articles]), [["Shipping", 2], ["Billing & plans", 2]]);
    await assert.rejects(saveCategory(ORG, { name: "Shipping", newName: " ", description: "" }), CategoryError);
  });
}
