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

export default function PricingPage() {
  return (
    <div className="mx-auto grid max-w-3xl gap-12 px-4 py-12">
      <div className="grid gap-3">
        <h1 className="font-display text-4xl">One plan. Every price is on this page.</h1>
        <p className="text-muted">No tiers, no add-ons and no sales call.</p>
      </div>

      <section className="grid gap-5 rounded-xl border border-accent bg-surface p-6">
        <p className="num text-5xl">
          {usd(PLAN.seatPrice)}
          <span className="text-lg text-muted"> per agent per month</span>
        </p>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-0.5">
            <dt className="text-sm text-muted">AI resolutions included</dt>
            <dd className="num text-xl">{PLAN.includedPerAgent} per agent</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-sm text-muted">When you reach them</dt>
            <dd className="text-xl">AI pauses</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-sm text-muted">Optional overage</dt>
            <dd className="num text-xl">{usd(PLAN.overageRate, true)} each</dd>
          </div>
        </dl>
        <p className="text-sm text-muted">
          Prices in US dollars, before any sales tax. Everything in the product is included: shared inbox, email and chat, macros and rules, AI
          answers, reporting, Zendesk import and data export.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/#waitlist" className="rounded-md bg-accent px-4 py-2 font-medium text-accent-ink">Join the waitlist</Link>
          <Link href="/calculator" className="rounded-md border border-line px-4 py-2">Compare with your current bill</Link>
        </div>
      </section>

      <section className="grid gap-5">
        <h2 className="font-display text-2xl">Questions about billing</h2>
        <dl className="grid gap-5">
          {FAQ.map(([q, a]) => (
            <div key={q} className="grid gap-1">
              <dt className="font-medium">{q}</dt>
              <dd className="text-muted">{a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
