import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ArticleBody from "@/components/ArticleBody";
import { articleUrl, excerpt, publishedArticle, translationsFor } from "@/lib/help";
import { helpWords, nativeName } from "@/lib/help-i18n";
import { helpCenter, helpHref, visitLanguage } from "../data";
import HelpFrame from "../HelpFrame";
import SearchForm from "../SearchForm";

async function load({ params, searchParams }: PageProps<"/help/[org]/[slug]">) {
  const { org: orgSlug, slug } = await params;
  const org = await helpCenter(orgSlug);
  const article = org ? await publishedArticle(org.id, slug) : undefined;
  if (!org || !article) return null;
  const lang = await visitLanguage(org, (await searchParams).lang);
  const translation = lang !== org.languages[0] ? (await translationsFor(org.id, lang, [article.id])).get(article.id) : undefined;
  return { org, article, lang, translation };
}

export async function generateMetadata(props: PageProps<"/help/[org]/[slug]">): Promise<Metadata> {
  const found = await load(props);
  if (!found) return {};
  const { org, article, lang, translation } = found;
  const url = articleUrl(org.helpSlug, article.slug, org.domain);
  const title = translation?.title ?? article.title;
  return {
    title: { absolute: `${title} · ${org.name} ${helpWords(lang).help}` },
    description: excerpt(translation?.body ?? article.body, 155),
    openGraph: { siteName: `${org.name} ${helpWords(lang).help}`, type: "article" },
    alternates: { canonical: translation ? `${url}?lang=${lang}` : url },
  };
}

export default async function HelpArticle(props: PageProps<"/help/[org]/[slug]">) {
  const found = await load(props);
  if (!found) notFound();
  const { org, article, lang, translation } = found;
  const w = helpWords(lang);
  const original = org.languages[0];
  const shown = translation ?? article;
  const updated = translation ? translation.updatedAt : article.updatedAt;
  return (
    <HelpFrame org={org} lang={lang} here={`/${article.slug}`}>
      <div className="grid gap-8">
        <SearchForm action={org.base || "/"} lang={lang} keepLang={lang !== original} />
        <article className="grid gap-6" lang={translation || lang === original ? lang : original}>
          <div className="grid gap-2">
            <Link href={helpHref(org, "", lang)} className="link w-max text-sm text-muted">{w.all}</Link>
            <h1 className="font-display text-4xl">{shown.title}</h1>
            <p className="text-sm text-muted">
              {w.updated}{" "}
              <time dateTime={updated.toISOString()}>{updated.toLocaleDateString(lang, { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}</time>
            </p>
            {lang !== original && !translation && (
              <p className="rounded-lg bg-surface-2 px-4 py-3 text-sm text-muted" lang={lang}>{`${w.untranslated} ${nativeName(original)}.`}</p>
            )}
          </div>
          <ArticleBody body={shown.body} />
        </article>
      </div>
    </HelpFrame>
  );
}
