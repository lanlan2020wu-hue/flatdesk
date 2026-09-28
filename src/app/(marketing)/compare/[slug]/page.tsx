import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CostTable from "@/components/CostTable";
import Faq from "@/components/Faq";
import JsonLd from "@/components/JsonLd";
import { COMPARED_ON, RIVALS, cheaperAnswer, costRows, rival } from "@/lib/compare";
import { breadcrumbs, faqPage, pageMeta } from "@/lib/seo";

export function generateStaticParams() {
  return RIVALS.map((r) => ({ slug: r.slug }));
}

export async function generateMetadata({ params }: PageProps<"/compare/[slug]">): Promise<Metadata> {
  const r = rival((await params).slug);
  if (!r) return {};
  return pageMeta({
    title: `Flatdesk vs ${r.title}: pricing, AI billing and features`,
    description: r.answer.split(". ").slice(0, 2).join(". ") + ".",
    path: `/compare/${r.slug}`,
    image: `/og/compare/${r.slug}`,
  });
}

function List({ title, items, tone }: { title: string; items: string[]; tone: "accent" | "muted" }) {
  return (
    <div className="card grid content-start gap-4 p-6">
      <h2 className="font-medium">{title}</h2>
      <ul className="grid gap-2.5">
        {items.map((it, i) => (
          <li key={it} style={{ "--i": i } as React.CSSProperties} className="ln flex gap-2.5">
            <svg viewBox="0 0 20 20" className={`mt-1 size-4 shrink-0 ${tone === "accent" ? "text-accent" : "text-muted"}`} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {tone === "accent" ? <path d="M5 10.5l3 3 7-7" /> : <path d="M5 10h10" />}
            </svg>
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function RivalPage({ params }: PageProps<"/compare/[slug]">) {
  const r = rival((await params).slug);
  if (!r) notFound();
  const faq = [
    { q: `Is Flatdesk cheaper than ${r.name}?`, a: cheaperAnswer(r) },
    ...r.faq,
  ];

  return (
    <div className="mx-auto grid max-w-5xl gap-16 px-4 pt-14 sm:px-6 sm:pt-20">
      <JsonLd
        data={[
          breadcrumbs([
            { name: "Compare", path: "/compare" },
            { name: `Flatdesk vs ${r.title}`, path: `/compare/${r.slug}` },
          ]),
          faqPage(faq),
        ]}
      />
      <div className="grid max-w-3xl gap-4">
        <p className="enter eyebrow flex items-center gap-2">
          <Link href="/compare" className="transition-colors hover:text-ink">Compare</Link>
          <span aria-hidden="true">/</span>
          {r.title}
        </p>
        <h1 style={{ "--d": 1 } as React.CSSProperties} className="enter font-display text-4xl sm:text-5xl">Flatdesk vs {r.title}</h1>
        <p style={{ "--d": 2 } as React.CSSProperties} className="enter text-lg text-muted">{r.answer}</p>
        <p style={{ "--d": 2 } as React.CSSProperties} className="enter text-sm text-muted">Checked {COMPARED_ON} against list prices. Sources are at the bottom.</p>
      </div>

      <section data-play="" aria-label="Monthly cost" className="grid gap-4">
        <CostTable rows={costRows(r)} caption={`Monthly cost with the AI answering the stated number of conversations.${costRows(r).some((x) => x.approx) ? ' "~" marks estimates.' : ""}`} />
        <Link href="/calculator" className="link w-max text-sm font-medium text-accent">Try it with your own numbers</Link>
      </section>

      <section data-play="" className="grid gap-4 md:grid-cols-2">
        <List title="Where Flatdesk is stronger" items={r.flatdeskWins} tone="accent" />
        <List title={`Where ${r.name} is stronger`} items={r.theyWin} tone="muted" />
      </section>

      <section data-play="" className="card grid gap-3 bg-surface-2/60 p-6 sm:p-8">
        <h2 className="ink font-display text-2xl">Which should you pick?</h2>
        <p><span className="font-medium">Pick {r.name} if</span> {r.pickThem.charAt(0).toLowerCase() + r.pickThem.slice(1)}</p>
        <p>
          <span className="font-medium">Pick Flatdesk if</span> you&apos;re an email and chat team of about 5 to 20 agents and want AI in the price, with a bill that doesn&apos;t move.
          {r.canImport ? ` The import brings your ${r.name} history with you.` : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          <Link href="/sign-up" className="btn btn-primary">
            Start your free trial
            <span aria-hidden="true" className="arrow">→</span>
          </Link>
          {r.canImport && <Link href="/features/lossless-import" className="btn btn-secondary">How the import works</Link>}
        </div>
      </section>

      <Faq items={faq} />

      <section className="grid gap-2 text-sm text-muted">
        <h2 className="eyebrow">Sources</h2>
        {r.sources.map((s) => (
          <a key={s.url} href={s.url} rel="noopener" className="link w-max max-w-full">{s.label}</a>
        ))}
      </section>
    </div>
  );
}
