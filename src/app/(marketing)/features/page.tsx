import Link from "next/link";
import JsonLd from "@/components/JsonLd";
import { FeatureIcon } from "@/components/ProductShots";
import { FEATURE_GROUPS } from "@/lib/features";
import { SELLING_POINTS } from "@/lib/selling-points";
import { breadcrumbs, pageMeta, software } from "@/lib/seo";

export const metadata = pageMeta({
  title: "Help desk features",
  description:
    "Everything in Flatdesk: a shared inbox for email and chat, capped AI answers, an AI test drive on your own tickets, AI receipts, AI macros that also assign, tag and close tickets, import, reports and export. Every seat gets every feature.",
  path: "/features",
});

const bySlug = (slug: string) => SELLING_POINTS.find((p) => p.slug === slug)!;

// Same order as the homepage: the flat rate, then AI macros, then the rest.
const CHAPTERS = [
  { n: "01", title: "Flat rate", lead: bySlug("flat-pricing"), more: [bySlug("ai-receipts")] },
  { n: "02", title: "AI macros", lead: bySlug("ai-macros"), more: [] },
  { n: "03", title: "Everything else", lead: null, more: SELLING_POINTS.filter((p) => !["flat-pricing", "ai-receipts", "ai-macros"].includes(p.slug)) },
];

function PointCard({ p, big = false }: { p: (typeof SELLING_POINTS)[number]; big?: boolean }) {
  return (
    <Link href={`/features/${p.slug}`} className={`lift card group grid content-start gap-3 ${big ? "border-accent/40 bg-accent-soft/40 p-6 sm:p-10" : "p-6 sm:p-8"}`}>
      <span className="flex items-center justify-between">
        <FeatureIcon d={p.icon} className={big ? "size-11 bg-accent-soft p-2.5" : undefined} />
      </span>
      <h3 className={`font-display ${big ? "text-3xl sm:text-4xl" : "text-2xl"}`}>{big ? p.headline : p.name}</h3>
      <p className={`text-muted ${big ? "max-w-[65ch] text-lg" : ""}`}>{big ? p.answer : p.short}</p>
      <span className="lift-link link w-max text-sm font-medium text-accent">How it works</span>
    </Link>
  );
}

export default function FeaturesPage() {
  return (
    <div className="mx-auto grid max-w-6xl gap-20 px-4 pt-14 sm:px-6 sm:pt-20">
      <JsonLd data={[software(), breadcrumbs([{ name: "Product", path: "/features" }])]} />
      <div>
        <div className="grid max-w-2xl gap-3">
          <h1 style={{ "--d": 1 } as React.CSSProperties} className="enter font-display text-[2.6rem] sm:text-6xl">Everything a small support team needs, at one flat price.</h1>
          <p style={{ "--d": 2 } as React.CSSProperties} className="enter text-lg text-muted">
            Flatdesk is a help desk for email and chat. Every seat gets every feature below, for one price per agent.
          </p>
        </div>
      </div>

      {CHAPTERS.map((c) => (
        <section key={c.n} data-play="" suppressHydrationWarning aria-labelledby={`ch-${c.n}`} className="grid gap-6">
          <h2 id={`ch-${c.n}`} className="font-display text-2xl">{c.title}</h2>
          {c.lead && <PointCard p={c.lead} big />}
          {c.more.length > 0 && (
            <div className={`grid gap-4 ${c.more.length > 2 ? "sm:grid-cols-2 lg:grid-cols-3" : c.more.length > 1 ? "sm:grid-cols-2" : ""}`}>
              {c.more.map((p) => (
                <PointCard key={p.slug} p={p} />
              ))}
            </div>
          )}
        </section>
      ))}

      <section data-play="" suppressHydrationWarning id="all" aria-labelledby="all-heading" className="grid scroll-mt-24 gap-10">
        <h2 id="all-heading" className="ink font-display text-3xl sm:text-4xl">Included in every seat</h2>
        <div className="grid gap-x-10 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
          {FEATURE_GROUPS.map((g) => (
            <div key={g.id} className="grid content-start gap-4">
              <h3 className="border-b border-line pb-2 font-medium">{g.title}</h3>
              <ul className="grid gap-4">
                {g.features.map((f, i) => (
                  <li key={f.id} style={{ "--i": i } as React.CSSProperties} className="flex gap-3">
                    <FeatureIcon d={f.icon} className="size-8 bg-accent-soft p-1.5" />
                    <span className="grid gap-0.5">
                      <span className="flex items-center gap-2 font-medium">
                        {f.title}
                      </span>
                      <span className="text-sm text-muted">{f.body}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
