import type { Metadata } from "next";
import Link from "next/link";
import { PLAN, usd } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Pricing",
  description: `${usd(PLAN.seatPrice)} per agent per month, with ${PLAN.includedPerAgent} AI resolutions per agent included and capped by default.`,
};

const FAQ: [string, string][] = [
  [
    "What counts as an AI resolution?",
    "A conversation the AI answers where the customer doesn't ask for a person afterwards. Conversations the AI hands to your team don't count. Each conversation counts at most once.",
  ],
  [
    "What happens when we use all the included resolutions?",
    "The AI stops answering for the rest of the month and new conversations go to your team as normal tickets. Nothing is charged. You get an email when you reach 80% and again at 100%.",
  ],
  [
    "How does overage work?",
    `Only an admin can turn it on, from billing settings. Each resolution past the included amount then costs ${usd(PLAN.overageRate, true)}. You can set a monthly limit, and you can turn overage off at any time.`,
  ],
  [
    "Are the resolutions per agent or per team?",
    `Per team. A 10-agent team gets ${(PLAN.includedPerAgent * 10).toLocaleString()} a month to share, however the tickets fall.`,
  ],
  [
    "Is there a contract or a minimum?",
    "No. Billing is monthly, you can add or remove seats at any time, and you can cancel from settings.",
  ],
  [
    "Can we take our data with us?",
    "Yes. Settings has a one-click export of all tickets, customers, tags and macros as CSV or JSON. You never need to ask us for it.",
  ],
];

const INCLUDED = [
  "Shared inbox",
  "Email and chat",
  "Macros and rules",
  "AI answers",
  "Reporting",
  "Zendesk import",
  "Data export",
];

export default function PricingPage() {
  return (
    <div className="mx-auto grid max-w-5xl gap-16 px-4 pt-14 sm:px-6 sm:pt-20">
      <div className="enter grid max-w-2xl gap-3">
        <p className="eyebrow">Pricing</p>
        <h1 className="font-display text-4xl sm:text-5xl">One plan. Every price is on this page.</h1>
        <p className="text-lg text-muted">No tiers, no add-ons and no sales call.</p>
      </div>

      <section style={{ "--d": 2 } as React.CSSProperties} className="enter card grid overflow-hidden shadow-lg md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="grid content-start gap-6 p-6 sm:p-8">
          <div className="grid gap-1">
            <p className="font-medium text-accent">Flatdesk</p>
            <p className="flex items-baseline gap-2">
              <span className="num text-6xl font-medium tracking-tight sm:text-7xl">{usd(PLAN.seatPrice)}</span>
              <span className="text-muted">per agent per month</span>
            </p>
          </div>
          <dl className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
            <div className="grid gap-1 bg-surface p-4">
              <dt className="text-sm text-muted">AI resolutions included</dt>
              <dd className="num">{PLAN.includedPerAgent} per agent</dd>
            </div>
            <div className="grid gap-1 bg-surface p-4">
              <dt className="text-sm text-muted">When you reach them</dt>
              <dd>AI pauses</dd>
            </div>
            <div className="grid gap-1 bg-surface p-4">
              <dt className="text-sm text-muted">Optional overage</dt>
              <dd className="num">{usd(PLAN.overageRate, true)} each</dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-3">
            <Link href="/#waitlist" className="btn btn-primary">Join the waitlist</Link>
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

      <section className="reveal grid gap-6 md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <h2 className="font-display text-3xl">Questions about billing</h2>
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
