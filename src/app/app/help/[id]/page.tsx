import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import ArticleBody from "@/components/ArticleBody";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { articleUrl, ensureHelpSlug } from "@/lib/help";
import { deleteArticleAction } from "../actions";
import ArticleForm from "../ArticleForm";
import { isUuid } from "@/lib/ids";

export const metadata = { title: "Edit article" };

export default async function EditArticle({ params, searchParams }: PageProps<"/app/help/[id]">) {
  const s = await requireSession();
  const { id } = await params;
  const { saved } = await searchParams;
  if (!isUuid(id)) notFound();
  const [article, helpSlug] = await Promise.all([
    db.query.articles.findFirst({ where: and(eq(schema.articles.orgId, s.orgId), eq(schema.articles.id, id)) }),
    ensureHelpSlug(s.orgId),
  ]);
  if (!article) notFound();
  const url = articleUrl(helpSlug, article.slug);

  return (
    <div className="grid max-w-3xl gap-6 px-4 py-6 md:px-8 md:py-8">
      <div className="flex items-center justify-between gap-3">
        <Link href="/app/help" className="link text-sm text-muted">Help center</Link>
        {article.published ? (
          <span className="pill bg-accent-soft text-accent">Published</span>
        ) : (
          <span className="pill bg-surface-2 text-muted">Draft</span>
        )}
      </div>

      {article.published ? (
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
        <ArticleForm key={article.updatedAt.toISOString()} article={article} />
      )}

      <section className="grid gap-3 border-t border-line pt-6">
        <h2 className="eyebrow">{s.viewer ? "Article" : "Preview"}</h2>
        <div className="card grid gap-4 p-6">
          <p className="font-display text-3xl">{article.title}</p>
          <ArticleBody body={article.body} />
        </div>
      </section>

      {!s.viewer && (
        <form action={deleteArticleAction}>
          <input type="hidden" name="id" value={article.id} />
          <button className="link text-sm text-warn">Delete article</button>
        </form>
      )}
    </div>
  );
}
