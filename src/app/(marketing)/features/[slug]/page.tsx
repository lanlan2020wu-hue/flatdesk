import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CostTable from "@/components/CostTable";
import Faq from "@/components/Faq";
import JsonLd from "@/components/JsonLd";
import { QualityShot, FeatureIcon, ImportShot, MacroShot, ReceiptShot, TestDriveShot } from "@/components/ProductShots";
import YearChart from "@/components/YearChart";
import { COMPARED_ON, RIVALS, costRows } from "@/lib/compare";
import { SELLING_POINTS, sellingPoint } from "@/lib/selling-points";
import { breadcrumbs, faqPage, pageMeta, software } from "@/lib/seo";

const SHOTS: Record<string, React.ReactNode> = {
  "flat-pricing": <YearChart />,
  "ai-receipts": <ReceiptShot />,
  "ai-test-drive": <TestDriveShot />,
  "ai-macros": <MacroShot />,
  "ai-quality-review": <QualityShot />,
  "lossless-import": <ImportShot />,
};

export function generateStaticParams() {
  return SELLING_POINTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/features/[slug]">): Promise<Metadata> {
  const p = sellingPoint((await params).slug);
  if (!p) return {};
  return pageMeta({ title: p.metaTitle, description: p.metaDescription, path: `/features/${p.slug}`, image: `/og/features/${p.slug}` });
}

export default async function SellingPointPage({ params }: PageProps<"/features/[slug]">) {
  const p = sellingPoint((await params).slug);
  if (!p) notFound();
  const others = SELLING_POINTS.filter((o) => o.slug !== p.slug);
  // Every rival's cheapest-to-compare plan next to Flatdesk, for the pricing page of the four.
  const allRows = p.slug === "flat-pricing" ? [costRows(RIVALS[0])[0], ...RIVALS.flatMap((r) => costRows(r).slice(1, 2))] : null;

  return (
    <div className="mx-auto grid max-w-6xl gap-20 px-4 pt-14 sm:px-6 sm:pt-20">
      <JsonLd
        data={[
          software(),
          breadcrumbs([
            { name: "Product", path: "/features" },
            { name: p.name, path: `/features/${p.slug}` },
          ]),
          faqPage(p.faq),
        ]}
      />
      <section className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div className="grid content-start gap-5">
          <p className="enter eyebrow flex items-center gap-2">
            <Link href="/features" className="transition-colors hover:text-ink">Product</Link>
            <span aria-hidden="true">/</span>
            {p.name}
            {p.isNew && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] tracking-[0.12em] text-accent-ink">New</span>}
          </p>
          <h1 style={{ "--d": 1 } as React.CSSProperties} className="enter font-display text-4xl leading-[1.08] sm:text-5xl">{p.headline}</h1>
          <p style={{ "--d": 2 } as React.CSSProperties} className="enter text-lg text-muted">{p.answer}</p>
          <div style={{ "--d": 3 } as React.CSSProperties} className="enter flex flex-wrap gap-3">
            <Link href="/sign-up" className="btn btn-primary">
              Start your free trial
              <span aria-hidden="true" className="arrow">→</span>
            </Link>
            <Link href="/pricing" className="btn btn-secondary">See pricing</Link>
          </div>
        </div>
        <div data-play="" className="relative">
          <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-accent-soft/70" aria-hidden="true" />
          {SHOTS[p.slug]}
        </div>
      </section>

      <section data-play="" aria-labelledby="how" className="grid gap-8">
        <h2 id="how" className="ink font-display text-3xl sm:text-4xl">How it works</h2>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {p.steps.map((s, i) => (
            <li key={s.title} style={{ "--i": i } as React.CSSProperties} className="ln card grid content-start gap-2 p-5">
              <span className="num text-sm text-accent">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="font-medium">{s.title}</h3>
              <p className="text-sm text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section data-play="" aria-labelledby="facts" className="grid gap-6 md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <h2 id="facts" className="ink font-display text-3xl">At a glance</h2>
        <ul className="grid gap-3">
          {p.facts.map((f, i) => (
            <li key={f} style={{ "--i": i } as React.CSSProperties} className="ln flex gap-2.5 border-b border-line pb-3">
              <svg viewBox="0 0 20 20" className="mt-1 size-4 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 10.5l3 3 7-7" /></svg>
              {f}
            </li>
          ))}
        </ul>
      </section>

      {allRows && (
        <section data-play="" aria-labelledby="costs" className="grid gap-6">
          <div className="grid max-w-2xl gap-3">
            <h2 id="costs" className="ink font-display text-3xl">What a team pays each month</h2>
            <p className="text-muted">
              List prices checked {COMPARED_ON}. Flatdesk isn&apos;t the cheapest seat; it&apos;s the bill that doesn&apos;t grow when the AI does more.{" "}
              <Link href="/compare" className="link text-accent">See each comparison</Link>.
            </p>
          </div>
          <CostTable rows={allRows} caption="Monthly cost, with the AI answering the stated number of conversations." />
        </section>
      )}

      <Faq items={p.faq} />

      <section data-play="" aria-labelledby="more" className="grid gap-6">
        <h2 id="more" className="ink eyebrow w-max">More reasons teams switch</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {others.map((o, i) => (
            <Link key={o.slug} href={`/features/${o.slug}`} style={{ "--i": i } as React.CSSProperties} className="lift card group flex flex-col gap-3 p-6">
              <FeatureIcon d={o.icon} />
              <span className="text-lg font-medium">{o.name}</span>
              <span className="text-muted">{o.short}</span>
              <span className="mt-auto text-sm font-medium text-accent">
                How it works <span aria-hidden="true" className="arrow inline-block transition-transform group-hover:translate-x-0.5">→</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
