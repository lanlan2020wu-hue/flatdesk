import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { SITE } from "@/lib/site";
import { slugify } from "@/lib/slug";

// The public help center: articles a team writes once, that customers search
// on their own at /help/<org>, and that the AI answers from and links to.

const { articles, articleTranslations, orgs } = schema;

export { slugify };

export const MAX_TITLE = 200;
export const MAX_BODY = 50_000;
// The AI reads at most this much of each article, so one long article can't crowd out the rest.
const AI_BODY_CHARS = 6_000;

// The public address: the team's own domain once it's verified, else ours.
export const helpUrl = (helpSlug: string, domain?: string | null) => (domain ? `https://${domain}` : `${SITE.url}/help/${helpSlug}`);
export const articleUrl = (helpSlug: string, slug: string, domain?: string | null) => `${helpUrl(helpSlug, domain)}/${slug}`;
export const verifiedDomain = (org: { helpDomain: string | null; helpDomainVerifiedAt: Date | null }) => (org.helpDomain && org.helpDomainVerifiedAt ? org.helpDomain : null);

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

// By its /help/<slug> address, or by its own domain (the proxy passes the host
// as the slug; slugs never contain a dot).
export async function orgByHelpSlug(helpSlug: string) {
  if (hasNul(helpSlug)) return undefined;
  const key = helpSlug.toLowerCase();
  return db.query.orgs.findFirst({ where: key.includes(".") ? eq(orgs.helpDomain, key) : eq(orgs.helpSlug, key) });
}

// Gives the org a help center address the first time it's needed: its name
// plus a short random tag, like acme-k3f9q2. Team names aren't unique (many
// teams are called "Support" or "My Organization"), so the name alone would
// hand same-named teams near-identical links that are easy to mix up or guess.
export async function ensureHelpSlug(orgId: string): Promise<string> {
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, orgId), columns: { helpSlug: true, name: true } });
  if (!org) throw new Error("Unknown team");
  if (org.helpSlug) return org.helpSlug;
  const base = helpSlugBase(org.name);
  for (let n = 0; n < 10; n++) {
    const candidate = `${base}-${randomTag()}`;
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

// The name part, kept short enough that "-" and the 6-character tag stay
// within the 40 characters the settings form allows.
export function helpSlugBase(name: string) {
  return slugify(name, "help").slice(0, 30).replace(/-+$/, "");
}

const TAG_CHARS = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o or 1/l, so it reads back clearly
function randomTag() {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => TAG_CHARS[b % TAG_CHARS.length]).join("");
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

// What customers can see: published and not team only.
const isPublic = and(eq(articles.published, true), eq(articles.internal, false));

export function publishedArticles(orgId: string) {
  return db
    .select()
    .from(articles)
    .where(and(eq(articles.orgId, orgId), isPublic))
    .orderBy(articles.title);
}

// Other published articles in a category, for "more in this category".
export function articlesInSection(orgId: string, section: string, exceptId: string, limit = 5) {
  return db
    .select()
    .from(articles)
    .where(and(eq(articles.orgId, orgId), isPublic, eq(articles.section, section), ne(articles.id, exceptId)))
    .orderBy(articles.title)
    .limit(limit);
}

export async function publishedArticle(orgId: string, slug: string) {
  if (hasNul(slug)) return undefined;
  return db.query.articles.findFirst({ where: and(eq(articles.orgId, orgId), eq(articles.slug, slug), isPublic) });
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
    .where(and(eq(articles.orgId, orgId), isPublic, sql`(${doc} @@ ${tsq} or ${articles.title} ilike ${like} or ${articles.body} ilike ${like})`))
    .orderBy(
      desc(sql`(${articles.title} ilike ${like})`),
      desc(sql`ts_rank(setweight(to_tsvector('english', ${articles.title}), 'A') || setweight(to_tsvector('english', ${articles.body}), 'B'), ${tsq})`),
      articles.title,
    )
    .limit(limit);
}

// ---- Translations ----------------------------------------------------------

export type Translation = typeof articleTranslations.$inferSelect;

export async function translationsFor(orgId: string, language: string, articleIds: string[]): Promise<Map<string, Translation>> {
  if (!articleIds.length) return new Map();
  const rows = await db
    .select()
    .from(articleTranslations)
    .where(and(eq(articleTranslations.orgId, orgId), eq(articleTranslations.language, language), inArray(articleTranslations.articleId, articleIds)));
  return new Map(rows.map((r) => [r.articleId, r]));
}

// Articles with their title and text in the visitor's language where a translation exists.
export function localize<T extends { id: string; title: string; body: string; section: string | null }>(list: T[], translations: Map<string, Translation>): (T & { translated: boolean })[] {
  return list.map((a) => {
    const t = translations.get(a.id);
    return t ? { ...a, title: t.title, body: t.body, section: a.section ? (t.section ?? a.section) : null, translated: true } : { ...a, translated: false };
  });
}

// Published articles whose translation in this language matches a search.
export async function searchTranslations(orgId: string, language: string, query: string, limit = 20) {
  const q = query.replace(/\0/g, "").trim().slice(0, 200);
  if (!q) return [];
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db
    .select({ article: articles })
    .from(articleTranslations)
    .innerJoin(articles, eq(articles.id, articleTranslations.articleId))
    .where(
      and(
        eq(articleTranslations.orgId, orgId),
        eq(articleTranslations.language, language),
        isPublic,
        sql`(${articleTranslations.title} ilike ${like} or ${articleTranslations.body} ilike ${like} or to_tsvector('simple', ${articleTranslations.title} || ' ' || ${articleTranslations.body}) @@ websearch_to_tsquery('simple', ${q}))`,
      ),
    )
    .orderBy(desc(sql`(${articleTranslations.title} ilike ${like})`), articleTranslations.title)
    .limit(limit);
  return rows.map((r) => r.article);
}

// A translation is stale when the article was edited after it was made.
export const isStale = (t: { sourceUpdatedAt: Date }, article: { updatedAt: Date }) => article.updatedAt.getTime() > t.sourceUpdatedAt.getTime();

// Published articles as the AI sees them: the text plus the public link, so a
// reply can point the customer at the article. Team-only articles are added
// only for drafts an agent reads before sending (`team`), never for the AI
// that answers customers on its own.
export async function articleKnowledge(orgId: string, opts: { team?: boolean } = {}): Promise<{ name: string; body: string }[]> {
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, orgId), columns: { helpSlug: true, helpDomain: true, helpDomainVerifiedAt: true } });
  const rows = await db
    .select({ title: articles.title, slug: articles.slug, body: articles.body, internal: articles.internal })
    .from(articles)
    .where(and(eq(articles.orgId, orgId), opts.team ? eq(articles.published, true) : isPublic))
    .orderBy(articles.internal, desc(articles.updatedAt))
    .limit(100);
  return rows.map((a) => {
    const text = plainText(a.body);
    const body = text.length > AI_BODY_CHARS ? `${text.slice(0, AI_BODY_CHARS)}…` : text;
    if (a.internal) return { name: `${a.title} (team only: use it to answer, but don't quote it or link to it)`, body };
    return { name: a.title, body: org?.helpSlug ? `${body}\n\nHelp center article: ${articleUrl(org.helpSlug, a.slug, verifiedDomain(org))}` : body };
  });
}

// Words people write to a help desk that say nothing about the question, left
// out when matching articles so "Hello, I need help with my refund" matches on "refund".
const FILLER = new Set(["hello", "thanks", "thank", "please", "help", "need", "question", "issue", "problem", "hope", "know", "want", "just", "able", "tried", "trying", "anyone", "someone", "there", "here", "what", "when", "where", "which", "while", "does", "doesn", "cannot", "wont", "dont", "really", "still", "also", "something", "anything"]);

export function matchWords(text: string) {
  return [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])].filter((w) => !FILLER.has(w)).slice(0, 12);
}

async function relatedArticles(orgId: string, text: string, limit: number, publicOnly: boolean) {
  const words = matchWords(text);
  if (!words.length) return [];
  const tsq = sql`to_tsquery('english', ${words.join(" | ")})`;
  const doc = sql`setweight(to_tsvector('english', ${articles.title}), 'A') || setweight(to_tsvector('english', ${articles.body}), 'B')`;
  return db
    .select({ id: articles.id, title: articles.title, slug: articles.slug, body: articles.body, internal: articles.internal, rank: sql<number>`ts_rank(${doc}, ${tsq})` })
    .from(articles)
    .where(and(eq(articles.orgId, orgId), publicOnly ? isPublic : eq(articles.published, true), sql`${doc} @@ ${tsq}`))
    .orderBy(desc(sql`ts_rank(${doc}, ${tsq})`), articles.title)
    .limit(limit);
}

// Published articles, team-only ones included, that look related to a ticket:
// any of its longer words, best match first. For the ticket's side rail.
export async function articlesForTicket(orgId: string, text: string, limit = 4) {
  return (await relatedArticles(orgId, text, limit, false)).map(({ id, title, internal }) => ({ id, title, internal }));
}

// Public articles that may answer what a visitor is typing into the chat
// widget, with links into the help center, so they can find the answer
// before starting a chat. Empty when the team has no help center or it's dark.
export async function articlesForChat(org: { id: string; helpSlug: string | null; helpDomain: string | null; helpDomainVerifiedAt: Date | null }, text: string, limit = 3) {
  if (!org.helpSlug) return [];
  const rows = await relatedArticles(org.id, text.slice(0, 2000), limit, true);
  // A visitor reads these before asking, so only the close matches: one
  // shared word ("order") shouldn't put shipping times under a refund question.
  const best = rows[0]?.rank ?? 0;
  return rows.filter((a) => a.rank >= best / 2).map((a) => ({ title: a.title, excerpt: excerpt(a.body, 120), url: articleUrl(org.helpSlug!, a.slug, verifiedDomain(org)) }));
}

// ---- Imported articles ------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", trade: "™" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

const safeHref = (href: string) => (/^(https?:\/\/|mailto:)\S+$/i.test(href) ? href.replace(/\)/g, "%29") : null);

// Turns another help desk's article HTML into the help center's text format:
// headings, lists, bold and links survive; images become links to the
// original file; tables and other markup become plain text.
export function htmlToArticle(html: string): string {
  const src = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  let out = "";
  const lists: { ordered: boolean; n: number }[] = [];
  let link: { href: string | null; text: string } | null = null;
  const emit = (s: string) => {
    if (link) link.text += s;
    else out += s;
  };
  const block = (prefix = "") => {
    if (link) return;
    out = out.replace(/[ \t]+$/, "");
    out += `\n\n${prefix}`;
  };
  const tag = /<(\/?)([a-z0-9]+)([^>]*)>/gi;
  let last = 0;
  for (const m of src.matchAll(tag)) {
    emit(decode(src.slice(last, m.index).replace(/\s+/g, " ")));
    last = m.index + m[0].length;
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    const attr = (k: string) => new RegExp(`${k}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(m[3])?.slice(2).find((v) => v !== undefined) ?? "";
    if (/^h[1-6]$/.test(name)) block(closing ? "" : name === "h1" || name === "h2" ? "## " : "### ");
    else if (name === "p" || name === "div" || name === "tr" || name === "table" || name === "blockquote" || name === "pre") block();
    else if (name === "br") emit("\n");
    else if (name === "ul" || name === "ol") {
      if (closing) lists.pop();
      else lists.push({ ordered: name === "ol", n: 0 });
      block();
    } else if (name === "li" && !closing) {
      const l = lists[lists.length - 1];
      out = out.replace(/[ \t]+$/, "");
      out += `\n${l?.ordered ? `${++l.n}. ` : "- "}`;
    } else if ((name === "strong" || name === "b") && !link) emit("**");
    else if (name === "td" || name === "th") emit(closing ? " " : "");
    else if (name === "a") {
      if (!closing) link = { href: safeHref(decode(attr("href"))), text: "" };
      else if (link) {
        const text = link.text.replace(/\s+/g, " ").replace(/\*\*/g, "").trim();
        const href = link.href;
        link = null;
        emit(href && text ? `[${text.replace(/[[\]]/g, "")}](${href})` : text);
      }
    } else if (name === "img") {
      const href = safeHref(decode(attr("src")));
      if (href) emit(`[${decode(attr("alt")).replace(/[[\]]/g, "").trim() || "Image"}](${href})`);
    }
  }
  emit(decode(src.slice(last).replace(/\s+/g, " ")));
  return out
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\*\*\s*\*\*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const MAX_SECTION = 80;
export const MAX_HELP_LANGUAGES = 10;

// Section names the team already uses, for the article form's suggestions.
export async function articleSections(orgId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ section: articles.section })
    .from(articles)
    .where(and(eq(articles.orgId, orgId), sql`${articles.section} is not null`))
    .orderBy(articles.section);
  return rows.map((r) => r.section!).filter(Boolean);
}
