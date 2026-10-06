import { SITE } from "@/lib/site";

// A team's help center on its own address, like help.acme.com. The team points
// a CNAME at Vercel; Flatdesk adds the domain to its Vercel project (which
// issues the certificate) and the proxy serves the help center there.
// Needs VERCEL_API_TOKEN (and VERCEL_TEAM_ID for a team-owned project); the
// project comes from Vercel's own VERCEL_PROJECT_ID.

export const CNAME_TARGET = "cname.vercel-dns.com";
const API = "https://api.vercel.com";

const token = () => process.env.VERCEL_API_TOKEN;
const projectId = () => process.env.VERCEL_DOMAINS_PROJECT_ID || process.env.VERCEL_PROJECT_ID;
export const domainsConfigured = () => Boolean(token() && projectId());

// Our own addresses: never a team's help center.
function ownHosts(): string[] {
  const site = new URL(SITE.url).hostname;
  return [site, `www.${site.replace(/^www\./, "")}`, "localhost", "127.0.0.1"];
}

// True for a request host that isn't Flatdesk's own, so it can only be a team's help center.
export function isCustomHost(host: string | null): host is string {
  if (!host) return false;
  const name = host.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  if (!name || ownHosts().includes(name)) return false;
  if (name.endsWith(".vercel.app") || name.endsWith(".localhost")) return false;
  if (/^[\d.]+$/.test(name) || name.includes(":")) return false; // IP addresses
  return true;
}

export const DOMAIN_RULE = "an address you own, like help.yourcompany.com";

// "https://Help.Acme.com/foo" -> "help.acme.com", or null when it isn't a usable host name.
export function normalizeDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/\.$/, "");
  if (s.length > 253 || !s.includes(".")) return null;
  const labels = s.split(".");
  if (!labels.every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return null;
  if (/^\d+$/.test(labels[labels.length - 1])) return null; // an IP address
  const site = new URL(SITE.url).hostname.replace(/^www\./, "");
  if (s === site || s.endsWith(`.${site}`) || s.endsWith(".vercel.app") || s.endsWith("vercel-dns.com")) return null;
  return s;
}

// A subdomain (help.acme.com) is pointed with a CNAME; a bare domain (acme.com) with an A record.
export const isApex = (domain: string) => domain.split(".").length === 2;
export const APEX_IP = "76.76.21.21";

export const dnsRecord = (domain: string) => (isApex(domain) ? { type: "A" as const, name: domain, value: APEX_IP } : { type: "CNAME" as const, name: domain, value: CNAME_TARGET });

export class DomainError extends Error {}

async function vercel(path: string, init: RequestInit = {}) {
  const url = new URL(path, API);
  if (process.env.VERCEL_TEAM_ID) url.searchParams.set("teamId", process.env.VERCEL_TEAM_ID);
  const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${token()}`, "content-type": "application/json", ...init.headers }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { code?: string; message?: string } };
  return { ok: res.ok, status: res.status, body };
}

export async function addDomain(domain: string): Promise<void> {
  if (!domainsConfigured()) throw new DomainError("Custom addresses aren't switched on for this workspace yet.");
  const r = await vercel(`/v10/projects/${projectId()}/domains`, { method: "POST", body: JSON.stringify({ name: domain }) });
  if (r.ok) return;
  if (r.status === 409) {
    // Already on this project (a second save) is fine; anywhere else isn't.
    const mine = await vercel(`/v9/projects/${projectId()}/domains/${encodeURIComponent(domain)}`);
    if (mine.ok) return;
    throw new DomainError(`${domain} is already connected to another site. Remove it there first, or pick another address.`);
  }
  console.error("vercel add domain failed", r.status, r.body.error);
  throw new DomainError("That address couldn't be connected. Check it's spelled right and try again.");
}

export async function removeDomain(domain: string): Promise<void> {
  if (!domainsConfigured()) return;
  const r = await vercel(`/v9/projects/${projectId()}/domains/${encodeURIComponent(domain)}`, { method: "DELETE" });
  if (!r.ok && r.status !== 404) console.error("vercel remove domain failed", domain, r.status, r.body.error);
}

export type DomainStatus =
  | { state: "ready" }
  | { state: "dns"; record: { type: "CNAME" | "A"; name: string; value: string } }
  | { state: "verify"; records: { type: string; name: string; value: string }[] }
  | { state: "unknown" };

// Where the domain stands: serving, waiting on the DNS record, or (when the
// domain is used elsewhere on Vercel) waiting on a TXT record proving it's theirs.
export async function domainStatus(domain: string): Promise<DomainStatus> {
  if (!domainsConfigured()) return { state: "unknown" };
  try {
    const [project, config] = await Promise.all([
      vercel(`/v9/projects/${projectId()}/domains/${encodeURIComponent(domain)}`),
      vercel(`/v6/domains/${encodeURIComponent(domain)}/config`),
    ]);
    if (!project.ok) return { state: "unknown" };
    if (project.body.verified === false) {
      const verify = await vercel(`/v9/projects/${projectId()}/domains/${encodeURIComponent(domain)}/verify`, { method: "POST" });
      if (!verify.ok || verify.body.verified === false) {
        const records = ((project.body.verification ?? []) as { type: string; domain: string; value: string }[]).map((v) => ({ type: v.type, name: v.domain, value: v.value }));
        return { state: "verify", records };
      }
    }
    if (config.ok && config.body.misconfigured === false) return { state: "ready" };
    return { state: "dns", record: dnsRecord(domain) };
  } catch (err) {
    console.error("vercel domain status failed", domain, err);
    return { state: "unknown" };
  }
}
