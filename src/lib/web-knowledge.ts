// Websites the AI reads. A team adds its website or docs address; Flatdesk
// reads up to WEB.maxPages pages under it (from the sitemap when there is one,
// otherwise by following links), keeps their text, and the AI answers from
// them next to the team's macros and help articles. Pages are read again
// every WEB.refreshDays by the daily cron, or when an admin asks.
//
// No AI call is made to read a site, so it costs nothing per page; the pages
// count toward the same knowledge size limit as everything else the AI reads
// (KNOWLEDGE_LIMITS in lib/ai.ts). Only public https addresses are fetched,
// over the same address checks as webhooks, and robots.txt is respected.

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { and, asc, count, eq, isNull, lt, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { isPrivateAddress, publicLookup } from "@/lib/alerts";
import { SITE } from "@/lib/site";

export const WEB = {
  maxSources: 3, // addresses per team
  maxPages: 40, // pages read under one address
  maxOrgPages: 80, // pages the AI reads across all of a team's addresses
  pageChars: 6_000, // of each page's text kept
  minChars: 150, // a page with less text than this (a login wall, a redirect stub) isn't kept
  maxBytes: 2_000_000, // of one response
  timeoutMs: 8_000, // per request
  budgetMs: 60_000, // per address read
  refreshDays: 7,
};

export class WebSourceError extends Error {}

const { webSources, webPages } = schema;

const allowPrivate = () => process.env.ALERTS_ALLOW_PRIVATE === "1";
const USER_AGENT = `FlatdeskBot/1.0 (+${SITE.url}/security)`;

// What an admin typed, as the address to read: https, a public host name, no
// query or fragment. "acme.com/docs" becomes "https://acme.com/docs".
export function checkSiteUrl(raw: string): { url: string } | { error: string } {
  let text = raw.trim();
  if (!text) return { error: "Enter your website or docs address." };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { error: "That doesn't look like a web address." };
  }
  if (u.protocol !== "https:" && !(allowPrivate() && u.protocol === "http:")) return { error: "The address has to start with https://." };
  if (u.username || u.password) return { error: "Leave the username and password out of the address. Flatdesk can only read public pages." };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!allowPrivate() && (isIP(host) || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local") || !host.includes("."))) {
    return { error: "Use your site's public address, not an IP address or a local name." };
  }
  u.hash = "";
  u.search = "";
  if (u.pathname !== "/" && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
  return { url: u.toString().replace(/\/$/, "") };
}

// ---- Fetching -------------------------------------------------------------

type Fetched = { url: string; status: number; type: string; body: string };

function getOnce(url: string, accept: string): Promise<Fetched & { location?: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (u.protocol !== "https:" && !(allowPrivate() && u.protocol === "http:")) return reject(new WebSourceError("Only https pages can be read."));
    if (isIP(host) && !allowPrivate() && isPrivateAddress(host)) return reject(new WebSourceError("The address doesn't resolve to a public server."));
    const send = u.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(u, { method: "GET", headers: { "user-agent": USER_AGENT, accept }, lookup: publicLookup, agent: false }, (res) => {
      const status = res.statusCode ?? 0;
      const type = String(res.headers["content-type"] ?? "").toLowerCase();
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        return resolve({ url, status, type, body: "", location: new URL(res.headers.location, url).toString() });
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > WEB.maxBytes) {
          req.destroy();
          return resolve({ url, status, type, body: Buffer.concat(chunks).toString("utf8") });
        }
        chunks.push(c);
      });
      res.on("end", () => resolve({ url, status, type, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.setTimeout(WEB.timeoutMs, () => req.destroy(new WebSourceError("The site took too long to answer.")));
    req.on("error", reject);
    req.end();
  });
}

// A GET that follows up to 4 redirects, checking each address as it goes.
export async function fetchPublic(url: string, accept = "text/html,application/xhtml+xml"): Promise<Fetched> {
  let current = url;
  for (let i = 0; i < 5; i++) {
    const r = await getOnce(current, accept);
    if (!r.location) return r;
    current = r.location;
  }
  throw new WebSourceError("The address redirects too many times.");
}

// ---- Reading pages -----------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", trade: "™" };

export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const DROP = ["script", "style", "noscript", "svg", "template", "iframe", "nav", "header", "footer", "form", "aside", "button", "select"];

// A page's title, readable text and links. Navigation, headers and footers are
// left out of the text (they repeat on every page) but their links are kept,
// since that's how the rest of the site is found.
export function readHtml(html: string, base: string): { title: string; text: string; links: string[] } {
  const links: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const href = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "").trim();
    if (!href || /^(mailto|tel|javascript|data):/i.test(href)) continue;
    try {
      links.push(new URL(href, base).toString());
    } catch {
      // not a usable link
    }
  }
  let doc = html.replace(/<!--[\s\S]*?-->/g, "");
  const rawTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(doc)?.[1] ?? /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(doc)?.[1] ?? "";
  for (const tag of DROP) doc = doc.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(doc)?.[1] ?? /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(doc)?.[1] ?? /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(doc)?.[1] ?? doc;
  const text = decodeEntities(
    main
      .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<(br|hr)\b[^>]*>/gi, "\n")
      .replace(/<\/?(p|div|section|h[1-6]|ul|ol|table|tr|blockquote|pre|dl|dt|dd)\b[^>]*>/gi, "\n")
      .replace(/<(td|th)\b[^>]*>/gi, " ")
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter((l, i, all) => l && !(l === "-" || (l === all[i - 1] && l.length < 40)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  const title = decodeEntities(rawTitle.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim().slice(0, 200);
  return { title, text, links };
}

const SKIP_EXT = /\.(pdf|jpe?g|png|gif|svg|webp|ico|zip|gz|css|js|json|xml|txt|mp4|mov|mp3|woff2?|ttf|eot|dmg|exe)$/i;
const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, "");

// Whether a link is under the address the team added: the same site, and
// the same section of it ("acme.com/docs" covers /docs and /docs/*).
export function inScope(link: string, root: string): string | null {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  const r = new URL(root);
  if (!["https:", "http:"].includes(u.protocol) || bareHost(u.hostname) !== bareHost(r.hostname)) return null;
  if (SKIP_EXT.test(u.pathname)) return null;
  const prefix = r.pathname.replace(/\/+$/, "");
  const path = u.pathname.replace(/\/+$/, "") || "/";
  if (prefix && path !== prefix && !path.startsWith(`${prefix}/`)) return null;
  u.hash = "";
  u.search = "";
  u.protocol = r.protocol;
  u.hostname = r.hostname;
  return u.toString().replace(/\/$/, "");
}

// robots.txt rules for us: the group for FlatdeskBot, else the one for *.
export function robotsRules(txt: string): { allow: string[]; disallow: string[] } {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], allow: [], disallow: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" && value) current.allow.push(value);
    if (key === "disallow" && value) current.disallow.push(value);
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== "*" && "flatdeskbot".includes(a))) ?? groups.find((g) => g.agents.includes("*"));
  return { allow: mine?.allow ?? [], disallow: mine?.disallow ?? [] };
}

export function robotsAllow(rules: { allow: string[]; disallow: string[] }, path: string) {
  const match = (p: string) => {
    const re = new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$")}`);
    return re.test(path);
  };
  const longest = (list: string[]) => Math.max(-1, ...list.filter(match).map((p) => p.length));
  return longest(rules.allow) >= longest(rules.disallow);
}

function sitemapLocs(xml: string) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1]));
}

async function sitemapUrls(root: string, deadline: number): Promise<string[]> {
  const origin = new URL(root).origin;
  try {
    const first = await fetchPublic(`${origin}/sitemap.xml`, "application/xml,text/xml");
    if (first.status !== 200) return [];
    let urls = sitemapLocs(first.body);
    if (/<sitemapindex/i.test(first.body)) {
      const children = urls.slice(0, 5);
      urls = [];
      for (const child of children) {
        if (Date.now() > deadline) break;
        const r = await fetchPublic(child, "application/xml,text/xml").catch(() => null);
        if (r?.status === 200) urls.push(...sitemapLocs(r.body));
      }
    }
    return urls;
  } catch {
    return [];
  }
}

export type ReadPage = { url: string; title: string; text: string };

// Reads up to WEB.maxPages pages under `root`: the address itself, then the
// sitemap's pages under it, then links found on the way.
export async function readSite(root: string, budgetMs = WEB.budgetMs): Promise<ReadPage[]> {
  const deadline = Date.now() + budgetMs;
  const origin = new URL(root).origin;
  const robots = await fetchPublic(`${origin}/robots.txt`, "text/plain")
    .then((r) => (r.status === 200 ? robotsRules(r.body) : { allow: [], disallow: [] }))
    .catch(() => ({ allow: [], disallow: [] }));
  const queue: string[] = [root];
  const seen = new Set<string>([root]);
  const push = (link: string) => {
    const u = inScope(link, root);
    if (u && !seen.has(u)) {
      seen.add(u);
      queue.push(u);
    }
  };
  for (const u of await sitemapUrls(root, deadline)) push(u);

  const pages: ReadPage[] = [];
  const texts = new Set<string>();
  let tries = 0;
  while (queue.length && pages.length < WEB.maxPages && tries < WEB.maxPages * 3 && Date.now() < deadline) {
    const url = queue.shift()!;
    tries++;
    if (!robotsAllow(robots, new URL(url).pathname)) continue;
    const r = await fetchPublic(url).catch(() => null);
    if (!r || r.status !== 200 || !/html/.test(r.type)) continue;
    // A redirect off the site (or out of its section) isn't followed into.
    const landed = inScope(r.url, root);
    if (!landed) continue;
    const page = readHtml(r.body, r.url);
    for (const l of page.links) push(l);
    if (page.text.length < WEB.minChars) continue;
    const hash = createHash("sha1").update(page.text).digest("hex");
    if (texts.has(hash)) continue;
    texts.add(hash);
    pages.push({ url: landed, title: page.title || new URL(landed).pathname, text: page.text.slice(0, WEB.pageChars) });
  }
  return pages;
}

// ---- Sources --------------------------------------------------------------

export async function listSources(orgId: string) {
  return db.select().from(webSources).where(eq(webSources.orgId, orgId)).orderBy(asc(webSources.createdAt));
}

export async function addSource(orgId: string, raw: string) {
  const checked = checkSiteUrl(raw);
  if ("error" in checked) throw new WebSourceError(checked.error);
  const [{ n }] = await db.select({ n: count() }).from(webSources).where(eq(webSources.orgId, orgId));
  if (Number(n) >= WEB.maxSources) throw new WebSourceError(`You can add up to ${WEB.maxSources} addresses. Remove one first.`);
  const [row] = await db.insert(webSources).values({ orgId, url: checked.url }).onConflictDoNothing().returning();
  if (!row) throw new WebSourceError("That address is already on the list.");
  return row;
}

export async function removeSource(orgId: string, id: string) {
  const [row] = await db.delete(webSources).where(and(eq(webSources.orgId, orgId), eq(webSources.id, id))).returning({ url: webSources.url });
  return row ?? null;
}

// Marks a source as being read again. False when it was read in the last few
// minutes, so repeated clicks don't hammer the team's site.
export async function markReading(orgId: string, id: string) {
  const recent = new Date(Date.now() - 5 * 60_000);
  const [row] = await db
    .update(webSources)
    .set({ status: "reading", error: null })
    .where(and(eq(webSources.orgId, orgId), eq(webSources.id, id), or(isNull(webSources.readAt), lt(webSources.readAt, recent))))
    .returning({ id: webSources.id });
  return Boolean(row);
}

// Reads one source and replaces its pages. Never throws.
export async function readSource(orgId: string, id: string, budgetMs = WEB.budgetMs) {
  const source = await db.query.webSources.findFirst({ where: and(eq(webSources.orgId, orgId), eq(webSources.id, id)) });
  if (!source) return null;
  try {
    const pages = await readSite(source.url, budgetMs);
    if (!pages.length) {
      await db
        .update(webSources)
        .set({ status: "failed", error: "No pages with text were found at that address. Check it opens in a browser without signing in.", readAt: new Date() })
        .where(eq(webSources.id, id));
      return 0;
    }
    await db.transaction(async (tx) => {
      await tx.delete(webPages).where(eq(webPages.sourceId, id));
      await tx.insert(webPages).values(pages.map((p) => ({ orgId, sourceId: id, url: p.url, title: p.title, text: p.text }))).onConflictDoNothing();
      await tx.update(webSources).set({ status: "ready", error: null, pageCount: pages.length, readAt: new Date() }).where(eq(webSources.id, id));
    });
    return pages.length;
  } catch (err) {
    console.error("reading website failed", source.url, err);
    const why = err instanceof WebSourceError ? err.message : "The site couldn't be read.";
    await db.update(webSources).set({ status: "failed", error: why, readAt: new Date() }).where(eq(webSources.id, id));
    return null;
  }
}

// Daily cron: reads again every source not read in WEB.refreshDays, while time lasts.
export async function refreshSources(opts: { budgetMs: number }) {
  const until = Date.now() + opts.budgetMs;
  const stale = new Date(Date.now() - WEB.refreshDays * 86_400_000);
  const due = await db
    .select({ id: webSources.id, orgId: webSources.orgId })
    .from(webSources)
    .where(or(isNull(webSources.readAt), lt(webSources.readAt, stale)))
    .orderBy(asc(webSources.readAt))
    .limit(50);
  let read = 0;
  for (const s of due) {
    const left = until - Date.now();
    if (left < 15_000) break;
    await readSource(s.orgId, s.id, Math.min(WEB.budgetMs, left - 5_000));
    read++;
  }
  return read;
}

// The pages as the AI reads them, after the team's own saved answers and articles.
export async function webKnowledge(orgId: string): Promise<{ name: string; body: string }[]> {
  const rows = await db
    .select({ url: webPages.url, title: webPages.title, text: webPages.text })
    .from(webPages)
    .innerJoin(webSources, eq(webSources.id, webPages.sourceId))
    .where(eq(webPages.orgId, orgId))
    .orderBy(asc(webSources.createdAt), asc(webPages.url))
    .limit(WEB.maxOrgPages);
  return rows.map((p) => ({ name: `${p.title} (from your website)`, body: `${p.text}\n\nPage: ${p.url}` }));
}
