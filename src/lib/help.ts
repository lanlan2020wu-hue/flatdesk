import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { SITE } from "@/lib/site";

// The public help center: articles a team writes once, that customers search
// on their own at /help/<org>, and that the AI answers from and links to.

const { articles, orgs } = schema;

export const MAX_TITLE = 200;
export const MAX_BODY = 50_000;
// The AI reads at most this much of each article, so one long article can't crowd out the rest.
const AI_BODY_CHARS = 6_000;

export function slugify(text: string, fallback = "article") {
  const s = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return s || fallback;
}

export const helpUrl = (helpSlug: string) => `${SITE.url}/help/${helpSlug}`;
export const articleUrl = (helpSlug: string, slug: string) => `${helpUrl(helpSlug)}/${slug}`;

// ---- Article text -----------------------------------------------------------
// Articles are plain text with a little markdown: "## Heading", "- item",
// "1. step", **bold** and [link](https://...). Anything else shows as written.
// Parsed into blocks and rendered as React elements, never as raw HTML.

export type Inline = { type: "text"; text: string } | { type: "bold"; text: string } | { type: "link"; text: string; href: string };
export type Block =
  | { type: "heading"; level: 2 | 3; content: Inline[] }
  | { type: "paragraph"; content: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] };

const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ type: "bold", text: m[1] });
    else out.push({ type: "link", text: m[2], href: m[3] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

export function parseArticle(body: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (para.length) blocks.push({ type: "paragraph", content: parseInline(para.join(" ")) });
    if (list) blocks.push({ type: "list", ordered: list.ordered, items: list.items.map(parseInline) });
    para = [];
    list = null;
  };
  for (const raw of body.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1].length === 3 ? 3 : 2, content: parseInline(heading[2]) });
      continue;
    }
    const bullet = /^[-*•]\s+(.+)$/.exec(line);
    const step = /^\d+[.)]\s+(.+)$/.exec(line);
    const item = bullet ?? step;
    if (item) {
      const ordered = Boolean(step && !bullet);
      if (para.length || (list && list.ordered !== ordered)) flush();
      list ??= { ordered, items: [] };
      list.items.push(item[1]);
      continue;
    }
    if (list) {
      // A line right under a list item continues it.
      list.items[list.items.length - 1] += ` ${line}`;
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}

// The article as plain text, for search results, excerpts and the AI.
export function plainText(body: string) {
  return parseArticle(body)
    .map((b) => {
      const txt = (c: Inline[]) => c.map((i) => (i.type === "link" ? `${i.text} (${i.href})` : i.text)).join("");
      if (b.type === "list") return b.items.map((it, n) => `${b.ordered ? `${n + 1}.` : "-"} ${txt(it)}`).join("\n");
      return txt(b.content);
    })
    .join("\n\n");
}

export function excerpt(body: string, max = 160) {
  const flat = parseArticle(body)
    .flatMap((b) => (b.type === "list" ? b.items : [b.content]))
    .map((c) => c.map((i) => i.text).join(""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ") > max * 0.6 ? cut.lastIndexOf(" ") : max).replace(/[\s.,;:]+$/, "")}…`;
}

// ---- Data ------------------------------------------------------------------

// Postgres can't compare text holding a NUL byte; it throws instead of
// finding nothing. Help center addresses and searches come from anyone.
const hasNul = (s: string) => s.includes("\0");

export async function orgByHelpSlug(helpSlug: string) {
  if (hasNul(helpSlug)) return undefined;
  return db.query.orgs.findFirst({ where: eq(orgs.helpSlug, helpSlug.toLowerCase()) });
}

// Gives the org a help center address the first time it's needed: its name as a slug, made unique.
export async function ensureHelpSlug(orgId: string): Promise<string> {
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, orgId), columns: { helpSlug: true, name: true } });
  if (!org) throw new Error("Unknown team");
  if (org.helpSlug) return org.helpSlug;
  // Kept within the rule the settings form enforces (3 to 40 characters), with room for a "-49".
  const named = slugify(org.name, "help").slice(0, 36).replace(/-+$/, "");
  const base = named.length < 3 ? `${named}-help` : named;
  for (let n = 1; n < 50; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const [row] = await db
      .update(orgs)
      .set({ helpSlug: candidate })
      .where(and(eq(orgs.id, orgId), sql`${orgs.helpSlug} is null`, sql`not exists (select 1 from orgs o where o.help_slug = ${candidate})`))
      .returning({ helpSlug: orgs.helpSlug });
    if (row?.helpSlug) return row.helpSlug;
    const again = await db.query.orgs.findFirst({ where: eq(orgs.id, orgId), columns: { helpSlug: true } });
    if (again?.helpSlug) return again.helpSlug; // set by a request running at the same time
  }
  throw new Error("Couldn't pick a help center address. Choose one in the help center settings.");
}

export const HELP_SLUG_RULE = "3 to 40 lowercase letters, numbers and dashes";
export const validHelpSlug = (s: string) => /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/.test(s) && !s.includes("--");

// A slug for a new article that no other article in the org uses.
export async function uniqueArticleSlug(orgId: string, title: string, exceptId?: string) {
  const base = slugify(title);
  const taken = new Set(
    (
      await db
        .select({ slug: articles.slug })
        .from(articles)
        .where(and(eq(articles.orgId, orgId), sql`${articles.slug} like ${`${base}%`}`, exceptId ? ne(articles.id, exceptId) : undefined))
    ).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

export function publishedArticles(orgId: string) {
  return db
    .select()
    .from(articles)
    .where(and(eq(articles.orgId, orgId), eq(articles.published, true)))
    .orderBy(articles.title);
}

export async function publishedArticle(orgId: string, slug: string) {
  if (hasNul(slug)) return undefined;
  return db.query.articles.findFirst({ where: and(eq(articles.orgId, orgId), eq(articles.slug, slug), eq(articles.published, true)) });
}

// Published articles matching a customer's search, best first. Full-text search
// (so "refunds" finds "refund") with a plain substring match as a fallback for
// partial words and product names.
export async function searchArticles(orgId: string, query: string, limit = 20) {
  const q = query.replace(/\0/g, "").trim().slice(0, 200);
  if (!q) return [];
  const doc = sql`to_tsvector('english', ${articles.title} || ' ' || ${articles.body})`;
  const tsq = sql`websearch_to_tsquery('english', ${q})`;
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return db
    .select()
    .from(articles)
    .where(and(eq(articles.orgId, orgId), eq(articles.published, true), sql`(${doc} @@ ${tsq} or ${articles.title} ilike ${like} or ${articles.body} ilike ${like})`))
    .orderBy(
      desc(sql`(${articles.title} ilike ${like})`),
      desc(sql`ts_rank(setweight(to_tsvector('english', ${articles.title}), 'A') || setweight(to_tsvector('english', ${articles.body}), 'B'), ${tsq})`),
      articles.title,
    )
    .limit(limit);
}

// Published articles as the AI sees them: the text plus the public link, so a
// reply can point the customer at the article.
export async function articleKnowledge(orgId: string): Promise<{ name: string; body: string }[]> {
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, orgId), columns: { helpSlug: true } });
  const rows = await db
    .select({ title: articles.title, slug: articles.slug, body: articles.body })
    .from(articles)
    .where(and(eq(articles.orgId, orgId), eq(articles.published, true)))
    .orderBy(desc(articles.updatedAt))
    .limit(100);
  return rows.map((a) => {
    const text = plainText(a.body);
    const body = text.length > AI_BODY_CHARS ? `${text.slice(0, AI_BODY_CHARS)}…` : text;
    return { name: a.title, body: org?.helpSlug ? `${body}\n\nHelp center article: ${articleUrl(org.helpSlug, a.slug)}` : body };
  });
}
