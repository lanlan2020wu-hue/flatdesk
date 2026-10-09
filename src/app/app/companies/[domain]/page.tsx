import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOpenPage } from "@/lib/auth";
import { COMPANY, companyDomain, companyTickets, getCompany } from "@/lib/companies";
import { timeAgo } from "@/lib/format";
import { saveCompanyAction } from "../actions";

export async function generateMetadata({ params }: PageProps<"/app/companies/[domain]">) {
  return { title: decodeURIComponent((await params).domain) };
}

export default async function CompanyPage({ params, searchParams }: PageProps<"/app/companies/[domain]">) {
  const s = await requireOpenPage();
  const [{ domain: raw }, sp] = await Promise.all([params, searchParams]);
  const domain = companyDomain(`x@${decodeURIComponent(raw)}`);
  if (!domain) notFound();
  const [company, list] = await Promise.all([getCompany(s.orgId, domain), companyTickets(s.orgId, domain, { limit: 100 })]);
  if (!company) notFound();
  const open = list.filter((t) => t.status !== "closed");
  const error = typeof sp.error === "string" ? sp.error.slice(0, 200) : null;

  return (
    <div className="grid max-w-5xl gap-8 px-4 py-6 md:px-8 md:py-8">
      <header className="grid gap-1.5">
        <Link href="/app/companies" className="text-sm text-muted hover:text-ink">← Companies</Link>
        <h1 className="page-title">{company.name}</h1>
        <p className="text-muted">
          {domain} · {company.people.length} {company.people.length === 1 ? "person" : "people"} · {open.length} open {open.length === 1 ? "ticket" : "tickets"}
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
        <section className="grid content-start gap-3">
          <h2 className="text-lg font-semibold">Tickets</h2>
          {list.length === 0 ? (
            <p className="text-muted">No tickets yet.</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface text-sm">
              {list.map((t) => (
                <li key={t.id} className="grid gap-0.5 px-4 py-2.5">
                  <Link href={`/app/tickets/${t.number}`} className="link truncate font-medium">{t.subject}</Link>
                  <span className="truncate text-xs text-muted">
                    <span className="num">#{t.number}</span> · <span className="capitalize">{t.status}</span> · {t.customerName || t.customerEmail} · {timeAgo(t.updatedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {list.length === 100 && (
            <p className="text-sm text-muted">
              The 100 most recent. <Link href={`/app/inbox?q=${encodeURIComponent(`@${domain}`)}`} className="link text-accent">Search the inbox</Link> for the rest.
            </p>
          )}
        </section>

        <aside className="grid content-start gap-6 text-sm">
          <form action={saveCompanyAction} className="grid gap-3">
            <input type="hidden" name="domain" value={domain} />
            <fieldset disabled={s.viewer} className="grid gap-3">
              <label className="grid gap-1.5">
                <span className="eyebrow">Name</span>
                <input name="name" defaultValue={company.named ? company.name : ""} placeholder={company.name} maxLength={COMPANY.nameMax} className="field field-sm" />
              </label>
              <label className="grid gap-1.5">
                <span className="eyebrow">Notes for the team</span>
                <textarea
                  name="notes"
                  defaultValue={company.notes}
                  rows={6}
                  maxLength={COMPANY.notesMax}
                  placeholder="Their plan, who to talk to, anything to know before replying"
                  className="field field-sm"
                />
                <span className="text-xs text-muted">Shown on every ticket from {domain}. Customers never see it.</span>
              </label>
              {error && <p role="alert" className="text-warn">{error}</p>}
              {sp.saved === "1" && !error && <p role="status" className="text-accent">Saved.</p>}
              {!s.viewer && <button className="btn btn-secondary btn-sm w-fit">Save</button>}
            </fieldset>
            {company.updatedBy && company.updatedAt && (
              <p className="text-xs text-muted">Last changed by {company.updatedBy} {timeAgo(company.updatedAt)}</p>
            )}
          </form>

          <section className="grid gap-2">
            <h2 className="eyebrow">People</h2>
            <ul className="grid gap-2">
              {company.people.map((p) => (
                <li key={p.id} className="grid">
                  <span className="truncate font-medium">{p.name || p.email}</span>
                  <span className="truncate text-xs text-muted">
                    {p.name ? `${p.email} · ` : ""}
                    {p.tickets} {p.tickets === 1 ? "ticket" : "tickets"}
                    {p.open > 0 ? `, ${p.open} open` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
