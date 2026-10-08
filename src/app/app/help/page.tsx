import Link from "next/link";
import { and, count, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireOpenPage } from "@/lib/auth";
import { domainsConfigured, domainStatus, dnsRecord } from "@/lib/domains";
import { ensureHelpSlug, excerpt, HELP_SLUG_RULE, helpUrl, MAX_HELP_LANGUAGES, verifiedDomain } from "@/lib/help";
import { LANGUAGES, languageLabel } from "@/lib/language";
import { SITE } from "@/lib/site";
import { checkHelpDomainAction, saveHelpDomainAction, saveHelpLanguagesAction, saveHelpSlugAction } from "./actions";

export const metadata = { title: "Help center" };

const host = SITE.url.replace(/^https?:\/\//, "");

export default async function HelpCenterAdmin({ searchParams }: PageProps<"/app/help">) {
  const s = await requireOpenPage();
  const { error, saved, domainError } = await searchParams;
  const [helpSlug, list, org] = await Promise.all([
    ensureHelpSlug(s.orgId),
    db.select().from(schema.articles).where(eq(schema.articles.orgId, s.orgId)).orderBy(desc(schema.articles.published), desc(schema.articles.updatedAt)),
    db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId), columns: { helpDomain: true, helpDomainVerifiedAt: true, helpLanguages: true, language: true } }),
  ]);
  const domain = org ? verifiedDomain(org) : null;
  // Until it's serving, show what's left to do (asks Vercel; only while unverified).
  const pending = org?.helpDomain && !org.helpDomainVerifiedAt ? await domainStatus(org.helpDomain) : null;
  const isAdmin = s.role === "admin";
  const translations = org?.helpLanguages.length
    ? await db
        .select({ language: schema.articleTranslations.language, n: count() })
        .from(schema.articleTranslations)
        .innerJoin(schema.articles, eq(schema.articles.id, schema.articleTranslations.articleId))
        .where(and(eq(schema.articleTranslations.orgId, s.orgId), eq(schema.articles.published, true), eq(schema.articles.internal, false)))
        .groupBy(schema.articleTranslations.language)
    : [];
  const [{ n: live }] = await db
    .select({ n: count() })
    .from(schema.articles)
    .where(and(eq(schema.articles.orgId, s.orgId), eq(schema.articles.published, true), eq(schema.articles.internal, false)));
  const url = helpUrl(helpSlug, domain);

  return (
    <div className="grid max-w-3xl gap-12 px-4 py-6 md:px-8 md:py-8">
      <section className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid max-w-xl gap-1">
            <h1 className="page-title">Help center</h1>
            <p className="text-sm text-muted">
              Articles your customers can search on their own. The AI reads published articles too, and links to them in its answers. Mark an article team only for internal how-tos: your team finds it here and beside matching tickets, and customers never see it.
            </p>
          </div>
          {!s.viewer && <Link href="/app/help/new" className="btn btn-primary">New article</Link>}
        </div>
        <p className="text-sm">
          {live === 0 ? "Nothing is published yet. Your help center is" : `${live} published ${live === 1 ? "article" : "articles"} at`}{" "}
          <a href={url} target="_blank" rel="noopener" className="link font-medium text-accent">{url.replace(/^https?:\/\//, "")}</a>
        </p>
        {list.length > 0 ? (
          <ul className="card divide-y divide-line overflow-hidden">
            {list.map((a) => (
              <li key={a.id}>
                <Link href={`/app/help/${a.id}`} className="grid gap-1 px-5 py-4 transition-colors hover:bg-surface-2/60">
                  <span className="flex items-center justify-between gap-3">
                    <span className="truncate font-medium">
                      {a.title}
                      {a.section && <span className="ml-2 text-sm font-normal text-muted">{a.section}</span>}
                    </span>
                    {a.published && a.internal ? (
                      <span className="pill shrink-0 bg-surface-2 text-ink">Team only</span>
                    ) : a.published ? (
                      <span className="pill shrink-0 bg-accent-soft text-accent">Published</span>
                    ) : (
                      <span className="pill shrink-0 bg-surface-2 text-muted">Draft</span>
                    )}
                  </span>
                  <span className="truncate text-sm text-muted">{excerpt(a.body, 200)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-muted">
            <p className="font-medium text-ink">Start with the questions you answer most.</p>
            <p className="mt-1 max-w-xl">
              Your macros are a good place to start, since each is an answer your team already sends. Shipping, refunds, password resets and plan changes are common first articles.
            </p>
          </div>
        )}
      </section>

      <section className="grid gap-4 border-t border-line pt-6">
        <h2 className="text-lg font-semibold">Address</h2>
        <form action={saveHelpSlugAction} className="grid gap-3 text-sm">
          <label htmlFor="helpSlug" className="font-medium">Your help center lives at</label>
          <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
            <span className="text-muted">{host}/help/</span>
            <input
              id="helpSlug"
              name="helpSlug"
              required
              defaultValue={helpSlug}
              disabled={s.role !== "admin"}
              pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]"
              title={HELP_SLUG_RULE}
              className="field min-w-0 flex-1 font-normal"
            />
          </div>
          {error && <p role="alert" className="text-warn">{String(error)}</p>}
          {saved === "address" && <p className="text-accent">Saved. Old links to the previous address no longer work.</p>}
          <p className="text-muted">
            Link to it from your site and email signature so customers find answers before they write in.
            {s.role !== "admin" && " Only admins can change the address."}
          </p>
          {s.role === "admin" && <button className="btn btn-secondary w-max">Save address</button>}
        </form>
      </section>

      <section id="domain" className="grid gap-4 border-t border-line pt-6 text-sm">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">Your own address</h2>
          <p className="max-w-xl text-muted">Serve the help center at an address on your own domain, like help.yourcompany.com. The AI&apos;s links and the help center&apos;s own links use it once it&apos;s working.</p>
        </div>
        {domainsConfigured() || org?.helpDomain ? (
          <form action={saveHelpDomainAction} className="grid gap-3">
            <label htmlFor="helpDomain" className="font-medium">Address</label>
            <div className="flex flex-wrap gap-2">
              <input id="helpDomain" name="helpDomain" defaultValue={org?.helpDomain ?? ""} placeholder="help.yourcompany.com" disabled={!isAdmin} maxLength={253} className="field min-w-0 flex-1 font-normal" />
              {isAdmin && <button className="btn btn-secondary">{org?.helpDomain ? "Change" : "Connect"}</button>}
            </div>
            {!isAdmin && <p className="text-muted">Only admins can change it.</p>}
          </form>
        ) : (
          <p className="text-muted">Not available on this workspace yet.</p>
        )}
        {domainError && <p role="alert" className="text-warn">{String(domainError)}</p>}
        {saved === "domain-removed" && <p className="text-accent">Disconnected. Your help center is back at {host}/help/{helpSlug} only.</p>}
        {domain && (
          <p className="rounded-lg bg-accent-soft px-4 py-3">
            {saved === "domain-ready" ? "It works. " : ""}Your help center is live at{" "}
            <a href={`https://${domain}`} target="_blank" rel="noopener" className="link font-medium text-accent">{domain}</a>
            . The old {host}/help/{helpSlug} address still works too.
          </p>
        )}
        {org?.helpDomain && !domain && (
          <div className="grid gap-3 rounded-lg border border-line px-4 py-3">
            {pending?.state === "verify" ? (
              <>
                <p>{org.helpDomain} is connected to another site on our hosting provider. Add this record at your domain provider to prove it&apos;s yours:</p>
                <DnsTable rows={pending.records} />
              </>
            ) : (
              <>
                <p>{saved === "domain" ? "Saved. " : ""}One step left: add this record where you manage {org.helpDomain.split(".").slice(-2).join(".")}&apos;s DNS.</p>
                <DnsTable rows={[dnsRecord(org.helpDomain)]} />
                <p className="text-muted">Some providers want only the first part of the name (like help). The secure certificate is set up for you once the record is in place.</p>
              </>
            )}
            {isAdmin && (
              <form action={checkHelpDomainAction}>
                <button className="btn btn-secondary w-max">Check now</button>
              </form>
            )}
          </div>
        )}
      </section>

      <section id="languages" className="grid gap-4 border-t border-line pt-6 text-sm">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">Languages</h2>
          <p className="max-w-xl text-muted">
            Articles are written in {languageLabel(org?.language ?? "en")} (change it in Settings). Add languages and each article gets a translation the AI writes in one click, which you can edit. Visitors see their browser&apos;s language when you offer it, and can switch.
          </p>
        </div>
        {translations.length > 0 && (
          <p>
            Translated so far:{" "}
            {translations.filter((t) => org?.helpLanguages.includes(t.language)).map((t) => `${languageLabel(t.language)} ${t.n} of ${live}`).join(" · ")}
          </p>
        )}
        <form action={saveHelpLanguagesAction} className="grid gap-3">
          <fieldset disabled={!isAdmin} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <legend className="sr-only">Languages to offer</legend>
            {LANGUAGES.filter((l) => l.code !== org?.language).map((l) => (
              <label key={l.code} className="flex items-center gap-2">
                <input type="checkbox" name="languages" value={l.code} defaultChecked={org?.helpLanguages.includes(l.code)} className="size-4 accent-[var(--accent)]" />
                {l.label}
              </label>
            ))}
          </fieldset>
          <p className="text-muted">Up to {MAX_HELP_LANGUAGES}. Each AI translation is one copilot action.{!isAdmin && " Only admins can change these."}</p>
          {saved === "languages" && <p className="text-accent">Saved.</p>}
          {isAdmin && <button className="btn btn-secondary w-max">Save languages</button>}
        </form>
      </section>
    </div>
  );
}

function DnsTable({ rows }: { rows: { type: string; name: string; value: string }[] }) {
  return (
    <table className="w-full text-left">
      <thead className="text-muted">
        <tr>
          <th className="py-1 pr-4 font-normal">Type</th>
          <th className="py-1 pr-4 font-normal">Name</th>
          <th className="py-1 font-normal">Value</th>
        </tr>
      </thead>
      <tbody className="font-mono text-xs">
        {rows.map((r) => (
          <tr key={`${r.type}${r.name}${r.value}`}>
            <td className="py-1 pr-4">{r.type}</td>
            <td className="break-all py-1 pr-4">{r.name}</td>
            <td className="break-all py-1">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
