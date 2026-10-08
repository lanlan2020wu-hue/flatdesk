import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { hit, LIMITS } from "@/lib/rate-limit";

const { helpSearches } = schema;

// The help center's search report: what visitors search for, and the searches
// that found nothing, which are the articles worth writing next.

export const HELP_SEARCH_DAYS = 180;
export const REPORT_DAYS = 30;

// One form per search, so "Refund?" and "refund" count together. Searches that
// look like they hold someone's details (an email address, a long number like
// an order or phone number) aren't kept.
export function normalizeQuery(raw: string): string | null {
  const q = raw.replace(/\0/g, "").toLowerCase().replace(/[\s"'“”‘’?!.,;:]+/g, " ").trim().slice(0, 120);
  if (q.length < 2) return null;
  if (/@/.test(q) || /\d[\d\s-]{6,}\d/.test(q)) return null;
  return q;
}

// Never throws: the report must never get in the way of the search itself.
export async function logHelpSearch(orgId: string, raw: string, results: number, ip: string) {
  try {
    const query = normalizeQuery(raw);
    if (!query) return;
    if (!(await hit(LIMITS.helpSearchLog(ip))).ok) return;
    await db.insert(helpSearches).values({ orgId, query, results });
  } catch (err) {
    console.error("help search log failed", orgId, err);
  }
}

export type SearchRow = { query: string; searches: number; results: number };

export async function helpSearchReport(orgId: string, now = new Date()) {
  const since = new Date(now.getTime() - REPORT_DAYS * 86_400_000);
  const where = and(eq(helpSearches.orgId, orgId), gte(helpSearches.createdAt, since));
  const grouped = (onlyMisses: boolean) =>
    db
      .select({ query: helpSearches.query, searches: count(), results: sql<number>`max(${helpSearches.results})::int` })
      .from(helpSearches)
      .where(where)
      .groupBy(helpSearches.query)
      // A miss stops being one once any search for it finds an article.
      .having(onlyMisses ? sql`max(${helpSearches.results}) = 0` : undefined)
      .orderBy(desc(count()), helpSearches.query)
      .limit(15);
  const [[totals], top, misses] = await Promise.all([
    db.select({ total: count(), empty: sql<number>`count(*) filter (where ${helpSearches.results} = 0)::int` }).from(helpSearches).where(where),
    grouped(false),
    grouped(true),
  ]);
  return { total: Number(totals.total), empty: Number(totals.empty), top: top as SearchRow[], misses: misses as SearchRow[] };
}

// Daily: searches older than HELP_SEARCH_DAYS are deleted.
export async function purgeHelpSearches(now = new Date()) {
  const gone = await db.delete(helpSearches).where(lt(helpSearches.createdAt, new Date(now.getTime() - HELP_SEARCH_DAYS * 86_400_000))).returning({ id: helpSearches.id });
  return gone.length;
}
