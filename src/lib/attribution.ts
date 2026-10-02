import type { SignupSource } from "@/db/schema";

// Where trial sign-ups come from. The proxy notes the campaign (utm_*, ?ref=)
// or referring site on a visitor's first page in a first-party cookie, and the
// team created after sign-up keeps it (orgs.onboarding.source).

export const SOURCE_COOKIE = "fd_src";
export const SOURCE_MAX_AGE = 90 * 86_400; // seconds

// Pages our customers' customers see (chat widget, help centers, ratings) and
// the app itself are not marketing traffic.
const NOT_MARKETING = /^\/(app|api|chat|help|rate|__clerk)(\/|$)/;

// Control characters are dropped: a NUL in a link would make Postgres refuse to save the team.
const clip = (v: string | null | undefined) => (v ? v.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 100) || undefined : undefined);

// The source to remember for this page view, or null to keep what we have.
// A visit with campaign parameters replaces an earlier one; otherwise the
// first visit wins.
export function sourceFromVisit(url: URL, referer: string | null, existing: boolean, now = new Date()): SignupSource | null {
  if (NOT_MARKETING.test(url.pathname)) return null;
  const q = url.searchParams;
  const tagged = clip(q.get("utm_source") ?? q.get("ref"));
  if (existing && !tagged) return null;
  let referrer: string | undefined;
  try {
    const host = referer ? new URL(referer).hostname : "";
    if (host && host !== url.hostname) referrer = host.replace(/^www\./, "");
  } catch {}
  const s: SignupSource = { source: tagged ?? referrer ?? "direct", at: now.toISOString() };
  const medium = clip(q.get("utm_medium"));
  const campaign = clip(q.get("utm_campaign"));
  if (medium) s.medium = medium;
  if (campaign) s.campaign = campaign;
  if (referrer) s.referrer = referrer;
  s.landing = url.pathname.slice(0, 100);
  return s;
}

// Next encodes cookie values itself.
export const encodeSource = (s: SignupSource) => JSON.stringify(s);

export function decodeSource(raw: string | undefined): SignupSource | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v.source !== "string") return null;
    const str = (x: unknown) => (typeof x === "string" ? clip(x) : undefined);
    const s: SignupSource = { source: str(v.source) ?? "direct", at: str(v.at) ?? new Date().toISOString() };
    for (const k of ["medium", "campaign", "referrer", "landing"] as const) {
      const val = str(v[k]);
      if (val) s[k] = val;
    }
    return s;
  } catch {
    return null;
  }
}
