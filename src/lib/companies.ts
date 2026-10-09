// Companies: customers grouped by the domain of their email address, so a
// ticket from jo@acme.com shows what else Acme has asked about and who else
// there writes in. Nothing to set up; the team can name a company and keep
// notes on it (plan, account manager, quirks), saved in `companies`.
//
// Personal mailboxes (gmail.com and the like) aren't companies.

import { and, asc, count, desc, eq, ilike, inArray, isNull, max, ne, notInArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";

const { companies, customers, tickets } = schema;

export const PERSONAL_MAIL = [
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk", "live.com", "msn.com", "yahoo.com", "yahoo.co.uk", "ymail.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.de", "gmx.net", "web.de", "mail.com",
  "zoho.com", "yandex.com", "yandex.ru", "qq.com", "163.com", "126.com", "fastmail.com", "hey.com", "tutanota.com", "mail.ru", "comcast.net",
  "att.net", "verizon.net", "orange.fr", "free.fr", "t-online.de", "libero.it", "naver.com", "rediffmail.com",
];
const PERSONAL = new Set(PERSONAL_MAIL);

export const COMPANY = { notesMax: 4000, nameMax: 120, listLimit: 200 };

export class CompanyError extends Error {}

// "Jo@Acme.com" -> "acme.com"; null for personal mailboxes and anything odd.
export function companyDomain(email: string | null | undefined): string | null {
  const domain = normalizeCompanyDomain(email?.split("@")[1] ?? "");
  return domain && !PERSONAL.has(domain) ? domain : null;
}

// From a URL or a typed domain: "acme.com", or null.
export function normalizeCompanyDomain(raw: string): string | null {
  const d = raw.trim().toLowerCase().replace(/\.$/, "");
  if (d.length > 253 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(d)) return null;
  return d;
}

// "acme-labs.co.uk" -> "Acme Labs", until someone names it.
export function guessCompanyName(domain: string): string {
  const parts = domain.split(".");
  const suffix = parts.length > 2 && parts[parts.length - 2].length <= 3 ? 2 : 1;
  const base = parts[Math.max(0, parts.length - suffix - 1)] ?? domain;
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

const live = (orgId: string) => and(eq(tickets.orgId, orgId), isNull(tickets.deletedAt), isNull(tickets.mergedIntoId), eq(tickets.test, false));

export type CompanySummary = { domain: string; name: string; named: boolean; notes: string; people: number; tickets: number; open: number; lastAt: Date | null };

// Every company with at least one ticket, busiest-recently first. `q` matches
// the domain or the saved name.
export async function listCompanies(orgId: string, q = ""): Promise<CompanySummary[]> {
  const term = q.trim().slice(0, 100);
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db
    .select({
      domain: sql<string>`${customers.domain}`,
      people: sql<number>`count(distinct ${customers.id})::int`,
      tickets: count(tickets.id),
      open: sql<number>`count(*) filter (where ${tickets.status} <> 'closed')::int`,
      lastAt: max(tickets.updatedAt),
      name: companies.name,
      notes: companies.notes,
    })
    .from(customers)
    .innerJoin(tickets, and(eq(tickets.customerId, customers.id), live(orgId)))
    .leftJoin(companies, and(eq(companies.orgId, orgId), eq(companies.domain, customers.domain)))
    .where(
      and(
        eq(customers.orgId, orgId),
        sql`${customers.domain} <> ''`,
        notInArray(sql`${customers.domain}`, PERSONAL_MAIL),
        term ? or(ilike(sql`${customers.domain}`, like), ilike(companies.name, like)) : undefined,
      ),
    )
    .groupBy(customers.domain, companies.name, companies.notes)
    .orderBy(desc(max(tickets.updatedAt)))
    .limit(COMPANY.listLimit);
  return rows.map((r) => ({ ...r, name: r.name || guessCompanyName(r.domain), named: Boolean(r.name), notes: r.notes ?? "", tickets: Number(r.tickets) }));
}

// One company, or null when nobody from it has written in and nothing is saved.
export async function getCompany(orgId: string, domain: string) {
  const [saved, people] = await Promise.all([
    db.query.companies.findFirst({ where: and(eq(companies.orgId, orgId), eq(companies.domain, domain)) }),
    companyPeople(orgId, domain),
  ]);
  if (!saved && people.length === 0) return null;
  return { domain, name: saved?.name || guessCompanyName(domain), named: Boolean(saved?.name), notes: saved?.notes ?? "", updatedBy: saved?.updatedBy ?? null, updatedAt: saved?.updatedAt ?? null, people };
}

// Everyone at the company who has written in, with how many tickets each.
export function companyPeople(orgId: string, domain: string) {
  return db
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      tickets: sql<number>`count(${tickets.id})::int`,
      open: sql<number>`count(${tickets.id}) filter (where ${tickets.status} <> 'closed')::int`,
      lastAt: max(tickets.updatedAt),
    })
    .from(customers)
    .leftJoin(tickets, and(eq(tickets.customerId, customers.id), live(orgId)))
    .where(and(eq(customers.orgId, orgId), eq(customers.domain, domain)))
    .groupBy(customers.id)
    .orderBy(sql`max(${tickets.updatedAt}) desc nulls last`, asc(customers.email))
    .limit(COMPANY.listLimit);
}

// The company's tickets, open ones first, then newest. `exceptCustomer` leaves
// out one person's (the ticket rail already lists theirs).
export function companyTickets(orgId: string, domain: string, opts: { exceptCustomer?: string; limit?: number } = {}) {
  return db
    .select({
      id: tickets.id,
      number: tickets.number,
      subject: tickets.subject,
      status: tickets.status,
      updatedAt: tickets.updatedAt,
      createdAt: tickets.createdAt,
      customerName: customers.name,
      customerEmail: customers.email,
    })
    .from(tickets)
    .innerJoin(customers, eq(customers.id, tickets.customerId))
    .where(and(live(orgId), eq(customers.domain, domain), opts.exceptCustomer ? ne(customers.id, opts.exceptCustomer) : undefined))
    .orderBy(sql`(${tickets.status} = 'closed')`, desc(tickets.updatedAt))
    .limit(opts.limit ?? COMPANY.listLimit);
}

// Open tickets per company, for the ticket rail's one-line summary.
export async function openByCompany(orgId: string, domains: string[]) {
  if (domains.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ domain: sql<string>`${customers.domain}`, open: count(tickets.id) })
    .from(tickets)
    .innerJoin(customers, eq(customers.id, tickets.customerId))
    .where(and(live(orgId), ne(tickets.status, "closed"), inArray(sql`${customers.domain}`, domains)))
    .groupBy(customers.domain);
  return new Map(rows.map((r) => [r.domain, Number(r.open)]));
}

export async function saveCompany(orgId: string, domain: string, input: { name: string; notes: string }, by: string) {
  const name = input.name.trim().replace(/\s+/g, " ");
  const notes = input.notes.trim();
  if (name.length > COMPANY.nameMax) throw new CompanyError(`Keep the name under ${COMPANY.nameMax} characters.`);
  if (notes.length > COMPANY.notesMax) throw new CompanyError(`Keep notes under ${COMPANY.notesMax} characters.`);
  if (!companyDomain(`x@${domain}`)) throw new CompanyError("That isn't a company domain.");
  await db
    .insert(companies)
    .values({ orgId, domain, name: name || null, notes, updatedBy: by })
    .onConflictDoUpdate({ target: [companies.orgId, companies.domain], set: { name: name || null, notes, updatedBy: by, updatedAt: sql`now()` } });
}
