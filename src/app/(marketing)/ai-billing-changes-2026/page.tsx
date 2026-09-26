import type { Metadata } from "next";
import Link from "next/link";
import { CHECKED_ON, PLAN, usd } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Zendesk and Fin (Intercom) AI billing changes in 2026",
  description:
    "A dated, sourced timeline of the 2026 changes to AI resolution billing at Zendesk and Fin (formerly Intercom), and what to check on your own account.",
};

type Event = { date: string; vendor: string; text: string; source: { label: string; url: string } };

const TIMELINE: Event[] = [
  {
    date: "Sep 10, 2026",
    vendor: "Fin (formerly Intercom)",
    text: "Salesforce completed its acquisition of Fin. Fin's AI pricing is still $0.99 per outcome for now.",
    source: {
      label: "Salesforce press release",
      url: "https://www.salesforce.com/news/press-releases/2026/09/10/salesforce-completes-acquisition-of-fin/",
    },
  },
  {
    date: "Jun 15, 2026",
    vendor: "Fin (formerly Intercom)",
    text: "Salesforce signed an agreement to acquire Fin, the company formerly called Intercom.",
    source: {
      label: "Salesforce press release",
      url: "https://www.salesforce.com/news/press-releases/2026/06/15/salesforce-signs-definitive-agreement-to-acquire-fin/",
    },
  },
  {
    date: "Mar 11, 2026",
    vendor: "Zendesk",
    text: "Zendesk announced it was acquiring Forethought, which builds AI agents for customer service.",
    source: {
      label: "TechCrunch",
      url: "https://techcrunch.com/2026/03/11/zendesk-acquires-agentic-customer-service-startup-forethought/",
    },
  },
  {
    date: "Jan 1, 2026",
    vendor: "Zendesk",
    text: "Automatic overage billing for automated resolutions began for customers on Agent Months (including Seasonal and Supplemental), Multi-Year and ELA subscriptions.",
    source: {
      label: "Zendesk help center",
      url: "https://support.zendesk.com/hc/en-us/articles/9908811576858",
    },
  },
  {
    date: "Dec 19, 2025",
    vendor: "Zendesk",
    text: "Zendesk said annual automated resolution allowances would be visible in Admin Center by this date.",
    source: {
      label: "Zendesk help center",
      url: "https://support.zendesk.com/hc/en-us/articles/9908811576858",
    },
  },
  {
    date: "Nov 11, 2025",
    vendor: "Zendesk",
    text: "Zendesk announced both changes above to affected customers.",
    source: {
      label: "Zendesk help center",
      url: "https://support.zendesk.com/hc/en-us/articles/9908811576858",
    },
  },
];

const CHECKS: [string, string, string][] = [
  [
    "Zendesk",
    "In Admin Center, open your automated resolutions usage page and check your allowance and what happens at the limit. Zendesk lets you pause AI agents at the limit instead of paying for overage.",
    "https://support.zendesk.com/hc/en-us/articles/9751536041754",
  ],
  [
    "Fin (formerly Intercom)",
    "Check how many Fin outcomes you were billed for last month. Each one costs $0.99, with no volume discount.",
    "https://www.getmacha.com/blog/intercom-fin-pricing",
  ],
  [
    "Help Scout",
    "AI resolutions cost $0.75 each. Help Scout lets you set a monthly spending limit in AI Answers billing.",
    "https://docs.helpscout.com/article/1746-ai-resolutions-pricing",
  ],
];

export default function ChangesPage() {
  return (
    <article className="mx-auto grid max-w-3xl gap-16 px-4 pt-14 sm:px-6 sm:pt-20">
      <header className="grid gap-4">
        <p className="eyebrow">Last checked {CHECKED_ON}</p>
        <h1 className="font-display text-4xl sm:text-5xl">What changed in AI support billing in 2026</h1>
        <p className="text-lg text-muted">
          Zendesk and Fin both charge for each conversation their AI resolves. Here is what changed in the last year, with a source for every
          line, and what to check on your own account.
        </p>
      </header>

      <section className="grid gap-6">
        <h2 className="font-display text-3xl">Timeline</h2>
        <ol className="relative grid gap-8 pl-8 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-line-strong">
          {TIMELINE.map((e) => (
            <li key={e.date + e.text} className="relative grid gap-1.5">
              <span className="absolute top-1.5 -left-8 size-[11px] rounded-full border-2 border-accent bg-bg" aria-hidden="true" />
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="num font-medium text-accent">{e.date}</span>
                <span className="chip">{e.vendor}</span>
              </p>
              <p>{e.text}</p>
              <a href={e.source.url} target="_blank" rel="noreferrer" className="link w-max text-sm text-muted">{e.source.label}</a>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-6">
        <h2 className="font-display text-3xl">What to check on your account</h2>
        <dl className="grid gap-4">
          {CHECKS.map(([vendor, text, url]) => (
            <div key={vendor} className="card grid gap-1.5 p-5">
              <dt className="font-medium">{vendor}</dt>
              <dd className="text-muted">{text} <a href={url} target="_blank" rel="noreferrer" className="link text-ink">Source</a></dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card relative grid gap-4 overflow-hidden border-accent/30 bg-accent-soft p-6 sm:p-8">
        <h2 className="font-display text-3xl">How Flatdesk bills AI</h2>
        <p>
          AI resolutions are part of the seat price: {PLAN.includedPerAgent} per agent per month, shared across the team, at{" "}
          {usd(PLAN.seatPrice)} per agent. At the limit the AI pauses. Overage at {usd(PLAN.overageRate, true)} per resolution exists only if
          an admin turns it on.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/calculator" className="btn btn-primary">Compare your bill</Link>
          <Link href="/pricing" className="btn btn-secondary">See pricing</Link>
        </div>
      </section>
    </article>
  );
}
