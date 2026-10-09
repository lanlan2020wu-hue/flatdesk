import Link from "next/link";
import { requireOpenPage } from "@/lib/auth";
import { COMPANY, listCompanies } from "@/lib/companies";
import { timeAgo } from "@/lib/format";

export const metadata = { title: "Companies" };

export default async function CompaniesPage({ searchParams }: PageProps<"/app/companies">) {
  const s = await requireOpenPage();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const rows = await listCompanies(s.orgId, q);

  return (
    <div className="grid max-w-5xl gap-6 px-4 py-6 md:px-8 md:py-8">
      <header className="grid gap-1.5">
        <h1 className="page-title">Companies</h1>
        <p className="max-w-xl text-muted">
          Customers grouped by the domain of their email, so you can see everything a company has asked about and who there writes in. Personal addresses like Gmail aren&apos;t grouped.
        </p>
      </header>
      <form action="/app/companies" role="search" className="flex max-w-xl gap-2">
        <input type="search" name="q" defaultValue={q} placeholder="Search by name or domain" aria-label="Search companies" className="field text-sm" />
        <button className="btn btn-secondary">Search</button>
      </form>
      {rows.length === 0 ? (
        <p className="text-muted">
          {q ? (
            <>
              No company matches &quot;{q}&quot;. <Link href="/app/companies" className="link text-accent">Show all</Link>
            </>
          ) : (
            "No companies yet. They show up here once customers write in from a company address."
          )}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr className="border-b border-line">
                <th scope="col" className="px-4 py-2 font-normal">Company</th>
                <th scope="col" className="px-4 py-2 text-right font-normal">People</th>
                <th scope="col" className="px-4 py-2 text-right font-normal">Open</th>
                <th scope="col" className="px-4 py-2 text-right font-normal">All tickets</th>
                <th scope="col" className="px-4 py-2 text-right font-normal">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.domain} className="border-b border-line last:border-0">
                  <th scope="row" className="px-4 py-2 text-left font-normal">
                    <Link href={`/app/companies/${c.domain}`} className="link font-medium">{c.name}</Link>
                    <span className="block text-xs text-muted">{c.domain}</span>
                  </th>
                  <td className="num px-4 py-2 text-right">{c.people}</td>
                  <td className={`num px-4 py-2 text-right ${c.open > 0 ? "font-medium" : "text-muted"}`}>{c.open}</td>
                  <td className="num px-4 py-2 text-right">{c.tickets}</td>
                  <td className="px-4 py-2 text-right text-muted">{c.lastAt ? timeAgo(c.lastAt) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length === COMPANY.listLimit && <p className="text-sm text-muted">Showing the {COMPANY.listLimit} most recently active. Search to find others.</p>}
    </div>
  );
}
