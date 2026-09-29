import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { excerpt, publishedArticles, searchArticles } from "@/lib/help";
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
        <h2 className="eyebrow">{q ? `${list.length} ${list.length === 1 ? "result" : "results"} for “${q}”` : "All articles"}</h2>
        {list.length > 0 ? (
          <ul className="card divide-y divide-line overflow-hidden">
            {list.map((a) => (
              <li key={a.id}>
                <Link href={`/help/${org.helpSlug}/${a.slug}`} className="grid gap-1 px-5 py-4 transition-colors hover:bg-surface-2/60">
                  <span className="font-medium">{a.title}</span>
                  <span className="text-sm text-muted">{excerpt(a.body)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="card px-5 py-4 text-sm text-muted">
            {q ? "Nothing matched. Try fewer or different words" : "No articles yet"}
            {org.supportEmail ? (
              <>
                , or email <a href={`mailto:${org.supportEmail}`} className="link text-accent">{org.supportEmail}</a> and we&apos;ll help.
              </>
            ) : (
              "."
            )}
          </p>
        )}
        {q && (
          <Link href={`/help/${org.helpSlug}`} className="link w-max text-sm text-muted">All articles</Link>
        )}
      </section>
    </div>
  );
}
