// Help center categories. An article's category is its `section` (a name the
// team types); `help_sections` adds an order and a line describing each one.
// The help center lists categories in that order, each with up to a few
// articles and a link to all of them (?c=<slug>), and an article links back
// to its category with others from it.

import { and, asc, count, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { MAX_SECTION } from "@/lib/help";

const { articles, articleTranslations, helpSections } = schema;

export const CATEGORY = { descriptionMax: 200, preview: 6 };

export class CategoryError extends Error {}

export type Category = { name: string; description: string; articles: number };

// "Billing & plans" -> "billing-plans", for ?c= links.
export function categorySlug(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "category"
  );
}

// Every category in use (articles of any state), in the team's order: ordered
// ones first, then the rest by name.
export async function listCategories(orgId: string): Promise<Category[]> {
  const [used, saved] = await Promise.all([
    db.select({ name: articles.section, n: count() }).from(articles).where(and(eq(articles.orgId, orgId), isNotNull(articles.section))).groupBy(articles.section),
    db.select().from(helpSections).where(eq(helpSections.orgId, orgId)).orderBy(asc(helpSections.position), asc(helpSections.name)),
  ]);
  const counts = new Map(used.filter((u) => u.name?.trim()).map((u) => [u.name!, Number(u.n)]));
  const out: Category[] = [];
  for (const s of saved) if (counts.has(s.name)) out.push({ name: s.name, description: s.description, articles: counts.get(s.name)! });
  const rest = [...counts.keys()].filter((n) => !out.some((c) => c.name === n)).sort((a, b) => a.localeCompare(b));
  for (const name of rest) out.push({ name, description: "", articles: counts.get(name)! });
  return out;
}

// Groups articles by category in the given order; unknown categories by name
// after them, and articles without one last.
export function groupByCategory<T extends { section: string | null }>(list: T[], order: string[]): { section: string | null; articles: T[] }[] {
  const groups = new Map<string | null, T[]>();
  for (const a of list) {
    const key = a.section?.trim() || null;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const rank = (name: string | null) => (name === null ? Infinity : order.includes(name) ? order.indexOf(name) : order.length);
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || (a ?? "").localeCompare(b ?? ""))
    .map(([section, articles]) => ({ section, articles }));
}

// Saves a category's description, and renames it on every article (and in
// every translation) when the name changed. Renaming onto an existing
// category merges the two.
export async function saveCategory(orgId: string, input: { name: string; newName: string; description: string }) {
  const name = input.name.trim();
  const newName = input.newName.replace(/\s+/g, " ").trim().slice(0, MAX_SECTION);
  const description = input.description.replace(/\s+/g, " ").trim();
  if (!newName) throw new CategoryError("Give the category a name.");
  if (description.length > CATEGORY.descriptionMax) throw new CategoryError(`Keep the description under ${CATEGORY.descriptionMax} characters.`);
  await db.transaction(async (tx) => {
    const old = await tx.query.helpSections.findFirst({ where: and(eq(helpSections.orgId, orgId), eq(helpSections.name, name)) });
    if (newName !== name) {
      await tx.update(articles).set({ section: newName }).where(and(eq(articles.orgId, orgId), eq(articles.section, name)));
      // A translated category name was for the old name; the new one gets translated again with its articles.
      await tx
        .update(articleTranslations)
        .set({ section: null })
        .where(and(eq(articleTranslations.orgId, orgId), sql`${articleTranslations.articleId} in (select id from ${articles} where ${articles.orgId} = ${orgId} and ${articles.section} = ${newName})`));
      if (old) await tx.delete(helpSections).where(eq(helpSections.id, old.id));
    }
    const position = old?.position ?? (await tx.select({ max: sql<number>`coalesce(max(${helpSections.position}), -1)::int` }).from(helpSections).where(eq(helpSections.orgId, orgId)))[0].max + 1;
    await tx
      .insert(helpSections)
      .values({ orgId, name: newName, description, position })
      // Merging into a category that has a description keeps it unless a new one was typed.
      .onConflictDoUpdate({ target: [helpSections.orgId, helpSections.name], set: { description: newName !== name && !description ? sql`${helpSections.description}` : description } });
  });
  return newName;
}

// Moves a category one place up or down, saving the whole order.
export async function moveCategory(orgId: string, name: string, dir: "up" | "down") {
  const order = (await listCategories(orgId)).map((c) => c.name);
  const i = order.indexOf(name);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  await db.transaction(async (tx) => {
    for (const [position, n] of order.entries()) {
      await tx
        .insert(helpSections)
        .values({ orgId, name: n, position })
        .onConflictDoUpdate({ target: [helpSections.orgId, helpSections.name], set: { position } });
    }
  });
}

// The team's saved order and descriptions, for the help center.
export async function categoryOrder(orgId: string) {
  const rows = await db
    .select({ name: helpSections.name, description: helpSections.description })
    .from(helpSections)
    .where(eq(helpSections.orgId, orgId))
    .orderBy(asc(helpSections.position), asc(helpSections.name));
  return { order: rows.map((r) => r.name), descriptions: new Map(rows.filter((r) => r.description).map((r) => [r.name, r.description])) };
}
