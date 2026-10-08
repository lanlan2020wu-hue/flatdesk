import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import ArticleBody from "@/components/ArticleBody";
import { db, schema } from "@/db";
import { requireOpenPage } from "@/lib/auth";
import { articleUrl, ensureHelpSlug, isStale, verifiedDomain } from "@/lib/help";
import { languageLabel } from "@/lib/language";
import { aiTranslateArticleAction, deleteArticleAction, deleteTranslationAction, saveTranslationAction } from "../actions";
import { articleSections } from "@/lib/help";
import ArticleForm from "../ArticleForm";
import { isUuid } from "@/lib/ids";

export const metadata = { title: "Edit article" };
// AI translations into several languages run inside the button's request.
export const maxDuration = 300;

export default async function EditArticle({ params, searchParams }: PageProps<"/app/help/[id]">) {
  const s = await requireOpenPage();
  const { id } = await params;
  const { saved, translated, translationError } = await searchParams;
  if (!isUuid(id)) notFound();
  const [article, helpSlug, org, translations] = await Promise.all([
    db.query.articles.findFirst({ where: and(eq(schema.articles.orgId, s.orgId), eq(schema.articles.id, id)) }),
    ensureHelpSlug(s.orgId),
    db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId), columns: { helpDomain: true, helpDomainVerifiedAt: true, helpLanguages: true } }),
    db.select().from(schema.articleTranslations).where(and(eq(schema.articleTranslations.orgId, s.orgId), eq(schema.articleTranslations.articleId, id))),
  ]);
  if (!article) notFound();
  const url = articleUrl(helpSlug, article.slug, org ? verifiedDomain(org) : null);
  const languages = org?.helpLanguages ?? [];
  const needsAi = languages.some((l) => {
    const t = translations.find((x) => x.language === l);
    return !t || (t.auto && isStale(t, article));
  });

  return (
    <div className="grid max-w-3xl gap-6 px-4 py-6 md:px-8 md:py-8">
      <div className="flex items-center justify-between gap-3">
        <Link href="/app/help" className="link text-sm text-muted">Help center</Link>
        {article.published && article.internal ? (
          <span className="pill bg-surface-2 text-ink">Team only</span>
        ) : article.published ? (
          <span className="pill bg-accent-soft text-accent">Published</span>
        ) : (
          <span className="pill bg-surface-2 text-muted">Draft</span>
        )}
      </div>

      {article.published && article.internal ? (
        <p className="rounded-lg bg-surface-2 px-4 py-3 text-sm">
          {saved === "published" ? "Published for your team. " : ""}Only your team sees this article, here and beside tickets it matches. It isn&apos;t on your help center, and the AI that answers customers doesn&apos;t use it; AI drafts for your team do.
        </p>
      ) : article.published ? (
        <p className="rounded-lg bg-accent-soft px-4 py-3 text-sm">
          {saved === "published" ? "Published at " : "Live at "}
          <a href={url} target="_blank" rel="noopener" className="link font-medium text-accent">{url.replace(/^https?:\/\//, "")}</a>
          . The AI can use it from the next ticket.
        </p>
      ) : (
        <p className="rounded-lg bg-surface-2 px-4 py-3 text-sm text-muted">
          {saved === "unpublished" ? "Unpublished. " : ""}Drafts aren&apos;t public and the AI doesn&apos;t use them.
        </p>
      )}
      {saved === "saved" && <p className="text-sm text-accent">Saved.</p>}

      {s.viewer ? (
        <h1 className="page-title">{article.title}</h1>
      ) : (
        <ArticleForm key={article.updatedAt.toISOString()} article={article} sections={await articleSections(article.orgId)} />
      )}

      <section className="grid gap-3 border-t border-line pt-6">
        <h2 className="eyebrow">{s.viewer ? "Article" : "Preview"}</h2>
        <div className="card grid gap-4 p-6">
          <p className="font-display text-3xl">{article.title}</p>
          <ArticleBody body={article.body} />
        </div>
      </section>

      {languages.length > 0 && !article.internal && (
        <section id="translations" className="grid gap-3 border-t border-line pt-6 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="eyebrow">Translations</h2>
            {!s.viewer && needsAi && (
              <form action={aiTranslateArticleAction}>
                <input type="hidden" name="articleId" value={article.id} />
                <input type="hidden" name="language" value="all" />
                <button className="btn btn-secondary">Translate the missing ones with AI</button>
              </form>
            )}
          </div>
          {translationError && <p role="alert" className="text-warn">{String(translationError)}</p>}
          {translated && !translationError && <p className="text-accent">{/^\d+$/.test(String(translated)) ? `Translated into ${translated} ${translated === "1" ? "language" : "languages"}.` : `Saved the ${languageLabel(String(translated))} translation.`}</p>}
          <ul className="card divide-y divide-line">
            {languages.map((l) => {
              const t = translations.find((x) => x.language === l);
              const stale = t && isStale(t, article);
              return (
                <li key={l} className="grid gap-3 px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{languageLabel(l)}</span>
                    <span className={`text-xs ${!t || stale ? "text-warn" : "text-muted"}`}>
                      {!t ? "Not translated: visitors see the original" : stale ? "Out of date: the article changed since" : t.auto ? "Translated by AI" : "Written by your team"}
                    </span>
                  </div>
                  {!s.viewer && (
                    <details>
                      <summary className="link w-max cursor-pointer text-muted">{t ? "Edit translation" : "Write it yourself"}</summary>
                      <form action={saveTranslationAction} className="mt-3 grid gap-2">
                        <input type="hidden" name="articleId" value={article.id} />
                        <input type="hidden" name="language" value={l} />
                        <input name="title" required maxLength={200} defaultValue={t?.title ?? ""} placeholder={article.title} aria-label={`${languageLabel(l)} title`} lang={l} className="field" />
                        {article.section && <input name="section" maxLength={80} defaultValue={t?.section ?? ""} placeholder={article.section} aria-label={`${languageLabel(l)} section`} lang={l} className="field" />}
                        <textarea name="body" required rows={10} defaultValue={t?.body ?? ""} aria-label={`${languageLabel(l)} article`} lang={l} className="field leading-relaxed" />
                        <div className="flex flex-wrap gap-2">
                          <button className="btn btn-primary">Save translation</button>
                        </div>
                      </form>
                    </details>
                  )}
                  {!s.viewer && (
                    <div className="flex flex-wrap gap-4">
                      <form action={aiTranslateArticleAction}>
                        <input type="hidden" name="articleId" value={article.id} />
                        <input type="hidden" name="language" value={l} />
                        <button className="link text-accent">{t ? "Translate again with AI" : "Translate with AI"}</button>
                      </form>
                      {t && (
                        <form action={deleteTranslationAction}>
                          <input type="hidden" name="articleId" value={article.id} />
                          <input type="hidden" name="language" value={l} />
                          <button className="link text-muted">Remove</button>
                        </form>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!s.viewer && (
        <form action={deleteArticleAction}>
          <input type="hidden" name="id" value={article.id} />
          <button className="link text-sm text-warn">Delete article</button>
        </form>
      )}
    </div>
  );
}
