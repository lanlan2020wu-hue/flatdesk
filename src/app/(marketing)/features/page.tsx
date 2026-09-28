import Link from "next/link";
import JsonLd from "@/components/JsonLd";
import { FeatureIcon } from "@/components/ProductShots";
import { FEATURE_GROUPS } from "@/lib/features";
import { SELLING_POINTS } from "@/lib/selling-points";
import { breadcrumbs, pageMeta, software } from "@/lib/seo";

export const metadata = pageMeta({
  title: "Help desk features",
  description:
    "Everything in Flatdesk: shared inbox, email and chat, AI answers with a cap, AI receipts, macros that write themselves, lossless import, reports and export. Every seat gets every feature.",
  path: "/features",
});

export default function FeaturesPage() {
  return (
    <div className="mx-auto grid max-w-6xl gap-20 px-4 pt-14 sm:px-6 sm:pt-20">
      <JsonLd data={[software(), breadcrumbs([{ name: "Product", path: "/features" }])]} />
      <div className="grid max-w-2xl gap-3">
        <p className="enter eyebrow">Product</p>
        <h1 style={{ "--d": 1 } as React.CSSProperties} className="enter font-display text-4xl sm:text-5xl">Four reasons teams switch, and everything else they need.</h1>
        <p style={{ "--d": 2 } as React.CSSProperties} className="enter text-lg text-muted">
          Flatdesk is a help desk for email and chat. Every seat gets every feature below, for one price per agent.
        </p>
      </div>

      <section data-play="" aria-label="Why teams switch" className="grid gap-4 sm:grid-cols-2">
        {SELLING_POINTS.map((p, i) => (
          <Link key={p.slug} href={`/features/${p.slug}`} style={{ "--i": i } as React.CSSProperties} className="lift card group grid content-start gap-3 p-6 sm:p-8">
            <span className="flex items-center justify-between">
              <FeatureIcon d={p.icon} />
              {p.isNew && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium tracking-[0.12em] text-accent-ink uppercase">New</span>}
            </span>
            <h2 className="font-display text-2xl">{p.name}</h2>
            <p className="text-muted">{p.short}</p>
            <span className="text-sm font-medium text-accent">
              How it works <span aria-hidden="true" className="arrow inline-block transition-transform group-hover:translate-x-0.5">→</span>
            </span>
          </Link>
        ))}
      </section>

      <section data-play="" aria-labelledby="all" className="grid gap-10">
        <h2 id="all" className="ink font-display text-3xl sm:text-4xl">Included in every seat</h2>
        <div className="grid gap-x-10 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
          {FEATURE_GROUPS.map((g) => (
            <div key={g.id} className="grid content-start gap-4">
              <h3 className="eyebrow border-b border-line pb-2">{g.title}</h3>
              <ul className="grid gap-4">
                {g.features.map((f, i) => (
                  <li key={f.id} style={{ "--i": i } as React.CSSProperties} className="flex gap-3">
                    <FeatureIcon d={f.icon} className="size-8 bg-accent-soft p-1.5" />
                    <span className="grid gap-0.5">
                      <span className="flex items-center gap-2 font-medium">
                        {f.title}
                        {f.isNew && <span className="rounded-full bg-accent px-1.5 py-px text-[10px] font-medium text-accent-ink">New</span>}
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
