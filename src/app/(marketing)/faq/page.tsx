import Link from "next/link";
import Faq from "@/components/Faq";
import JsonLd from "@/components/JsonLd";
import { BILLING_FAQ, GENERAL_FAQ } from "@/lib/faq";
import { SELLING_POINTS } from "@/lib/selling-points";
import { breadcrumbs, faqPage, pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "Help desk questions, answered",
  description: "Straight answers about Flatdesk: what it costs, how AI resolutions are counted and capped, AI macros, AI receipts, and importing from another help desk.",
  path: "/faq",
});

export default function FaqPage() {
  const all = [...GENERAL_FAQ, ...BILLING_FAQ, ...SELLING_POINTS.flatMap((p) => p.faq)];
  const unique = all.filter((f, i) => all.findIndex((g) => g.q === f.q) === i);
  return (
    <div className="mx-auto grid max-w-5xl gap-16 px-4 pt-14 sm:px-6 sm:pt-20">
      <JsonLd data={[breadcrumbs([{ name: "FAQ", path: "/faq" }]), faqPage(unique)]} />
      <div className="grid max-w-2xl gap-3">
        <h1 style={{ "--d": 1 } as React.CSSProperties} className="enter font-display text-4xl sm:text-5xl">Questions, answered plainly.</h1>
        <p style={{ "--d": 2 } as React.CSSProperties} className="enter text-lg text-muted">
          Can&apos;t find yours? Compare Flatdesk with the tool you use today on the <Link href="/compare" className="link text-accent">comparison pages</Link>.
        </p>
      </div>
      <Faq items={GENERAL_FAQ} title="About Flatdesk" id="about" />
      <Faq items={BILLING_FAQ} title="Pricing and billing" id="billing" />
      {SELLING_POINTS.map((p) => (
        <Faq key={p.slug} items={p.faq.filter((f) => unique.includes(f))} title={p.name} id={p.slug} />
      ))}
    </div>
  );
}
