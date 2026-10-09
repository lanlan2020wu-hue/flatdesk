import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import Link from "next/link";
import AddOnTable from "@/components/AddOnTable";
import WhyFlat from "@/components/WhyFlat";
import { BILLING_FAQ } from "@/lib/faq";
import { PLAN, PRICE_PHRASE, annualSavingsPct, usd } from "@/lib/pricing";
import PhotoHero from "@/components/PhotoHero";
import pricingReview from "@/assets/photos/pricing-review.webp";

export const metadata: Metadata = pageMeta({
  title: `Help desk pricing: ${usd(PLAN.seatPrice)} per agent, AI included`,
  description: `${PRICE_PHRASE}, with ${PLAN.includedPerAgent} AI answers per agent included and capped by default. One plan, every feature, no add-ons.`,
  path: "/pricing",
});

const FAQ = BILLING_FAQ.map((f) => [f.q, f.a] as const);

const INCLUDED = [
  "Shared inbox",
  "Email and chat, with attachments",
  "Macros and rules",
  "AI macros that suggest their own updates and can assign, tag, close and send",
  "AI answers, capped by default",
  "AI receipts and refunds",
  "Reporting",
  "Lossless import from Zendesk, Intercom, Freshdesk or Help Scout",
  "Data export",
];

export default function PricingPage() {
  return (
    <div className="mx-auto grid max-w-5xl gap-16 px-4 pt-14 sm:px-6 sm:pt-20">
      <PhotoHero photo={pricingReview} alt="A support lead smiling at her laptop" layout="left">
        <div className="enter grid max-w-2xl gap-3">
          <h1 className="font-display text-[2.6rem] sm:text-6xl">One plan. Every price is on this page.</h1>
          <p className="text-lg text-muted">No tiers, no add-ons and no sales call.</p>
        </div>
      </PhotoHero>

      <section style={{ "--d": 2 } as React.CSSProperties} className="enter card grid overflow-hidden md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="grid content-start gap-6 p-6 sm:p-8">
          <div className="grid gap-1">
            <p className="font-medium text-accent">Flatdesk</p>
            <p className="flex items-baseline gap-2">
              <span className="num text-6xl font-medium tracking-tight sm:text-7xl">{usd(PLAN.annualSeatPrice)}</span>
              <span className="text-muted">per agent per month, billed yearly</span>
            </p>
            <p className="text-muted">
              Or <span className="num text-ink">{usd(PLAN.seatPrice)}</span> month to month with no contract. Yearly saves {annualSavingsPct}%
              ({usd((PLAN.seatPrice - PLAN.annualSeatPrice) * 12)} per agent a year).
            </p>
          </div>
          <dl className="grid gap-px border-y border-line bg-line sm:grid-cols-3">
            <div className="grid gap-1 bg-surface py-4 sm:pr-4">
              <dt className="text-sm text-muted">AI answers included</dt>
              <dd className="num">{PLAN.includedPerAgent} per agent</dd>
            </div>
            <div className="grid gap-1 bg-surface py-4 sm:px-4">
              <dt className="text-sm text-muted">When you reach them</dt>
              <dd>AI pauses</dd>
            </div>
            <div className="grid gap-1 bg-surface py-4 sm:pl-4">
              <dt className="text-sm text-muted">Optional overage</dt>
              <dd className="num">{usd(PLAN.overageRate, true)} each</dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-3">
            <Link href="/sign-up" className="btn btn-primary">Start your free trial</Link>
            <Link href="/calculator" className="btn btn-secondary">Compare with your current bill</Link>
          </div>
        </div>
        <div className="grid content-start gap-4 border-t border-line bg-surface-2/70 p-6 sm:p-8 md:border-t-0 md:border-l">
          <p className="font-medium">Everything in the product is included</p>
          <ul className="grid gap-2.5">
            {INCLUDED.map((item) => (
              <li key={item} className="flex items-center gap-2.5">
                <svg viewBox="0 0 20 20" className="size-4.5 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 10.5l3 3 7-7" /></svg>
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-auto text-sm text-muted">Prices in US dollars, before any sales tax.</p>
        </div>
      </section>

      <section id="why-less" className="scroll-mt-24">
        <WhyFlat headingLevel="h2" />
      </section>

      <section data-play="" suppressHydrationWarning className="grid gap-6">
        <h2 className="ink font-display text-3xl">AI macros: included here; elsewhere a higher plan, an add-on, or not offered</h2>
        <AddOnTable />
      </section>

      <section data-play="" suppressHydrationWarning className="grid gap-6 md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <h2 className="ink font-display text-3xl">Questions about billing</h2>
        <div className="grid border-b border-line">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group border-t border-line">
              <summary className="flex cursor-pointer items-center justify-between gap-4 py-4 font-medium transition-colors hover:text-accent">
                {q}
                <svg viewBox="0 0 20 20" className="chevron size-4 shrink-0 text-muted transition-transform" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 8l5 5 5-5" /></svg>
              </summary>
              <p className="pb-5 text-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
