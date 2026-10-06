import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { bySection, excerpt, publishedArticles, searchArticles } from "@/lib/help";
import { helpCenter } from "./data";
import SearchForm from "./SearchForm";

export async function generateMetadata({ params }: PageProps<"/help/[org]">): Promise<Metadata> {
  const org = await helpCenter((await params).org);
  if (!org) return {};
  return { title: { absolute: `${org.name} Help` }, description: `Answers from the ${org.name} team.`, openGraph: { siteName: `${org.name} Help` } };
}

export default async function HelpHome({ params, searchParams }: PageProps<"/help/[org]">) {
  const org = await helpCenter((await params).org);
  if (!org) notFound();
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 200) ?? "";
  const list = q ? await searchArticles(org.id, q) : await publishedArticles(org.id);

  return (
    <div className="grid gap-8">
      <div className="grid gap-4">
        <h1 className="font-display text-4xl">How can we help?</h1>
        <SearchForm helpSlug={org.helpSlug} q={q} autoFocus={!q} />
      </div>
      <section className="grid gap-3" aria-live="polite">
        {q && <h2 className="eyebrow">{`${list.length} ${list.length === 1 ? "result" : "results"} for “${q}”`}</h2>}
        {list.length > 0 ? (
          (q ? [{ section: null, articles: list }] : bySection(list)).map((g, i, groups) => (
            <div key={g.section ?? ""} className="grid gap-3">
              {!q && <h2 className="eyebrow">{g.section ?? (groups.length > 1 ? "More articles" : "All articles")}</h2>}
              <ul className="card divide-y divide-line overflow-hidden">
                {g.articles.map((a) => (
                  <li key={a.id}>
                    <Link href={`/help/${org.helpSlug}/${a.slug}`} className="grid gap-1 px-5 py-4 transition-colors hover:bg-surface-2/60">
                      <span className="font-medium">{a.title}</span>
                      <span className="text-sm text-muted">{excerpt(a.body)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {i < groups.length - 1 && <span aria-hidden="true" className="h-2" />}
            </div>
          ))
        ) : (
          <p className="card px-5 py-4 text-sm text-muted">
            {q ? "Nothing matched. Try fewer or different words" : "No articles yet"}
            , or{" "}
            <a href={`/chat/${org.widgetKey}`} target="_blank" rel="noreferrer" className="link text-accent">chat with us</a> and we&apos;ll help.
          </p>
        )}
        {q && (
          <Link href={`/help/${org.helpSlug}`} className="link w-max text-sm text-muted">All articles</Link>
        )}
      </section>
    </div>
  );
}
