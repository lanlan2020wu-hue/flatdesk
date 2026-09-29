import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ArticleBody from "@/components/ArticleBody";
import { excerpt, publishedArticle } from "@/lib/help";
import { helpCenter } from "../data";
import SearchForm from "../SearchForm";

async function load(params: PageProps<"/help/[org]/[slug]">["params"]) {
  const { org: orgSlug, slug } = await params;
  const org = await helpCenter(orgSlug);
  const article = org ? await publishedArticle(org.id, slug) : undefined;
  return org && article ? { org, article } : null;
}

export async function generateMetadata({ params }: PageProps<"/help/[org]/[slug]">): Promise<Metadata> {
  const found = await load(params);
  if (!found) return {};
  return {
    title: { absolute: `${found.article.title} · ${found.org.name} Help` },
    description: excerpt(found.article.body, 155),
    openGraph: { siteName: `${found.org.name} Help`, type: "article" },
  };
}

export default async function HelpArticle({ params }: PageProps<"/help/[org]/[slug]">) {
  const found = await load(params);
  if (!found) notFound();
  const { org, article } = found;
  return (
    <div className="grid gap-8">
      <SearchForm helpSlug={org.helpSlug} />
      <article className="grid gap-6">
        <div className="grid gap-2">
          <Link href={`/help/${org.helpSlug}`} className="link w-max text-sm text-muted">All articles</Link>
          <h1 className="font-display text-4xl">{article.title}</h1>
          <p className="text-sm text-muted">
            Updated{" "}
            <time dateTime={article.updatedAt.toISOString()}>
              {article.updatedAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}
            </time>
          </p>
        </div>
        <ArticleBody body={article.body} />
      </article>
    </div>
  );
}
