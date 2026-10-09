import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { excerpt, helpUrl, localize, publishedArticles, searchArticles, searchTranslations, translationsFor } from "@/lib/help";
import { helpWords } from "@/lib/help-i18n";
import { logHelpSearch } from "@/lib/help-searches";
import { CATEGORY, categoryOrder, categorySlug, groupByCategory } from "@/lib/help-sections";
import { ipKey } from "@/lib/rate-limit";
import { helpCenter, helpHref, visitLanguage } from "./data";
import HelpFrame from "./HelpFrame";
import SearchForm from "./SearchForm";

export async function generateMetadata({ params, searchParams }: PageProps<"/help/[org]">): Promise<Metadata> {
  const org = await helpCenter((await params).org);
  if (!org) return {};
  const lang = await visitLanguage(org, (await searchParams).lang);
  const home = helpUrl(org.helpSlug, org.domain);
  return {
    title: { absolute: `${org.name} ${helpWords(lang).help}` },
    description: `Answers from the ${org.name} team.`,
    openGraph: { siteName: `${org.name} ${helpWords(lang).help}` },
    alternates: { canonical: lang === org.languages[0] ? home : `${home}?lang=${lang}`, languages: org.languages.length > 1 ? Object.fromEntries(org.languages.map((l, i) => [l, i === 0 ? home : `${home}?lang=${l}`])) : undefined },
  };
}

export default async function HelpHome({ params, searchParams }: PageProps<"/help/[org]">) {
  const org = await helpCenter((await params).org);
  if (!org) notFound();
  const sp = await searchParams;
  const lang = await visitLanguage(org, sp.lang);
  const w = helpWords(lang);
  const translated = lang !== org.languages[0];
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim().slice(0, 200) ?? "";
  let found = q ? await searchArticles(org.id, q) : await publishedArticles(org.id);
  if (q && translated) {
    // Matches in the visitor's language first, then matches in the original.
    const local = await searchTranslations(org.id, lang, q);
    found = [...local, ...found.filter((a) => !local.some((l) => l.id === a.id))].slice(0, 20);
  }
  const list = translated ? localize(found, await translationsFor(org.id, lang, found.map((a) => a.id))) : found;
  if (!q && translated) list.sort((a, b) => a.title.localeCompare(b.title, lang));
  // Categories in the team's order. Translated articles carry their category's
  // translated name, so the order and descriptions go by the original's.
  const { order, descriptions } = await categoryOrder(org.id);
  const originalSection = new Map(found.map((a) => [a.id, a.section?.trim() || null]));
  const groups = groupByCategory(
    list.map((a) => ({ ...a, label: a.section, section: originalSection.get(a.id) ?? null })),
    order,
  ).map((g) => ({
    ...g,
    slug: g.section ? categorySlug(g.section) : null,
    label: g.articles[0]?.label?.trim() || g.section,
    description: translated ? "" : (g.section && descriptions.get(g.section)) || "",
  }));
  const c = typeof sp.c === "string" && !q ? groups.find((g) => g.slug === sp.c) : undefined;
  const shown = q ? [{ section: null, slug: null, label: null, description: "", articles: list }] : c ? [c] : groups;
  if (q) {
    const ip = ipKey(new Request("http://x", { headers: await headers() }));
    after(() => logHelpSearch(org.id, q, list.length, ip));
  }

  return (
    <HelpFrame org={org} lang={lang} here="">
      <div className="grid gap-8">
        <div className="grid gap-4">
          <h1 className="font-display text-4xl">{w.heading}</h1>
          <SearchForm action={org.base || "/"} lang={lang} keepLang={translated} q={q} autoFocus={!q} />
        </div>
        <section className="grid gap-3" aria-live="polite">
          {q && <h2 className="eyebrow">{`${w.results} “${q}” (${list.length})`}</h2>}
          {c && (
            <div className="grid gap-1">
              <Link href={helpHref(org, "", lang)} className="link w-max text-sm text-muted">{w.all}</Link>
              <h2 className="font-display text-2xl">{c.label}</h2>
              {c.description && <p className="text-muted">{c.description}</p>}
            </div>
          )}
          {list.length > 0 ? (
            shown.map((g, i) => {
              const cut = !q && !c && shown.length > 1 && g.articles.length > CATEGORY.preview;
              return (
                <div key={g.section ?? ""} className="grid gap-3">
                  {!q && !c && (
                    <div className="grid gap-0.5">
                      <h2 className="eyebrow">
                        {g.slug ? <Link href={helpHref(org, "", lang, { c: g.slug })} className="hover:text-ink">{g.label}</Link> : shown.length > 1 ? w.more : w.all}
                      </h2>
                      {g.description && <p className="text-sm text-muted">{g.description}</p>}
                    </div>
                  )}
                  <ul className="card divide-y divide-line overflow-hidden">
                    {(cut ? g.articles.slice(0, CATEGORY.preview) : g.articles).map((a) => (
                      <li key={a.id}>
                        <Link href={helpHref(org, `/${a.slug}`, lang)} className="grid gap-1 px-5 py-4 transition-colors hover:bg-surface-2/60">
                          <span className="font-medium">{a.title}</span>
                          <span className="text-sm text-muted">{excerpt(a.body)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {cut && g.slug && (
                    <Link href={helpHref(org, "", lang, { c: g.slug })} className="link w-max text-sm text-accent">{`${w.seeAll} (${g.articles.length})`}</Link>
                  )}
                  {i < shown.length - 1 && <span aria-hidden="true" className="h-2" />}
                </div>
              );
            })
          ) : (
            <p className="card px-5 py-4 text-sm text-muted">
              {q ? w.nothing : w.empty},{" "}
              <a href={`/chat/${org.widgetKey}`} target="_blank" rel="noreferrer" className="link text-accent">{w.orChat}</a>
            </p>
          )}
          {q && (
            <Link href={helpHref(org, "", lang)} className="link w-max text-sm text-muted">{w.all}</Link>
          )}
        </section>
      </div>
    </HelpFrame>
  );
}
