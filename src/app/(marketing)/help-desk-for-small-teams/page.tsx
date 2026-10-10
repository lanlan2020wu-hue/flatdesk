import Link from "next/link";
import Faq from "@/components/Faq";
import JsonLd from "@/components/JsonLd";
import { TRIAL_DAYS } from "@/lib/billing";
import { PLAN, PRICE_PHRASE, flatdeskMonthly, usd } from "@/lib/pricing";
import { breadcrumbs, faqPage, pageMeta, software } from "@/lib/seo";
import { SELLING_POINTS } from "@/lib/selling-points";
import { LEFT_OUT } from "@/lib/why-flat";

// For people searching "help desk for small teams" and similar: who Flatdesk is
// for, what it costs at small team sizes, and what it leaves out. Every figure
// comes from pricing.ts and every gap from why-flat.ts, so it can't drift.

export const metadata = pageMeta({
  title: "Help desk for small support teams (3 to 15 agents)",
  description: `A help desk built for small support teams: email and chat in one inbox, AI answers included and capped, one plan. ${PRICE_PHRASE}. ${TRIAL_DAYS}-day trial, no card.`,
  path: "/help-desk-for-small-teams",
});

const SIZES = [3, 5, 10, 15];

const FAQ = [
  {
    q: "What's the best help desk for a small support team?",
    a: `It depends on what you need. If your team answers email and website chat, has about 3 to 15 agents, and wants AI included without a bill that grows with it, Flatdesk fits: ${PRICE_PHRASE}, with ${PLAN.includedPerAgent} AI answers per agent included. If you need phone, social channels or an app marketplace, a bigger suite such as Zendesk fits better. If you're 1 or 2 people using little AI, Help Scout's free plan costs less.`,
  },
  {
    q: "How much does a help desk cost for a team of 5?",
    a: `On Flatdesk, 5 agents cost ${usd(flatdeskMonthly(5, 0, "year").seats)} a month billed yearly, or ${usd(flatdeskMonthly(5, 0).seats)} billed monthly, with ${PLAN.includedPerAgent * 5} AI answers a month included. The AI pauses at that number unless an admin turns on overage, so the bill stays the same.`,
  },
  {
    q: "Do small teams need AI in their help desk?",
    a: "Not always. It pays off when a good share of your tickets are questions your team has answered before. Flatdesk's AI test drive drafts replies to your last 50 answered tickets next to what your team actually sent, so you can judge it on your own customers before paying.",
  },
  {
    q: "Can we switch from Zendesk or Intercom without losing history?",
    a: "Yes. Flatdesk imports tickets, messages, attachments, customers, tags and macros from Zendesk, Intercom, Freshdesk and Help Scout, keeps every original record, and lists anything that didn't map. You can keep the old help desk running during the trial.",
  },
];

export default function SmallTeamsPage() {
  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-20 px-4 pt-14 sm:px-6 sm:pt-20">
      <JsonLd data={[software(), breadcrumbs([{ name: "Help desk for small teams", path: "/help-desk-for-small-teams" }]), faqPage(FAQ)]} />

      <section className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-14">
        <div className="grid max-w-3xl gap-5">
          <h1 style={{ "--d": 1 } as React.CSSProperties} className="enter font-display text-[2.6rem] sm:text-6xl">A help desk for small support teams</h1>
          <p style={{ "--d": 2 } as React.CSSProperties} className="enter text-lg text-muted">
            Flatdesk is for teams of about 3 to 15 agents who answer customers by email and website chat. One plan at {PRICE_PHRASE}, with {PLAN.includedPerAgent} AI answers per agent included. The AI pauses at the cap, so the bill is the same every month.
          </p>
          <div style={{ "--d": 3 } as React.CSSProperties} className="enter flex flex-wrap gap-3">
            <Link href="/sign-up" className="btn btn-primary">Start your free trial</Link>
            <Link href="/calculator" className="btn btn-secondary">Compare your current bill</Link>
          </div>
        </div>
      </section>

      <section data-play="" suppressHydrationWarning aria-labelledby="cost" className="grid gap-6">
        <div className="grid max-w-2xl gap-3">
          <h2 id="cost" className="ink font-display text-3xl">What a small team pays</h2>
          <p className="text-muted">Every seat gets every feature. There are no tiers, add-ons or AI meters.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-sm text-muted">
                <th scope="col" className="py-3 pr-4 font-medium">Team</th>
                <th scope="col" className="py-3 pr-4 font-medium">Billed yearly</th>
                <th scope="col" className="py-3 pr-4 font-medium">Billed monthly</th>
                <th scope="col" className="py-3 font-medium">AI answers included</th>
              </tr>
            </thead>
            <tbody className="num">
              {SIZES.map((n, i) => (
                <tr key={n} style={{ "--i": i } as React.CSSProperties} className="ln border-b border-line">
                  <th scope="row" className="py-3 pr-4 font-sans font-medium">{n} agents</th>
                  <td className="py-3 pr-4">{usd(flatdeskMonthly(n, 0, "year").seats)}/mo</td>
                  <td className="py-3 pr-4">{usd(flatdeskMonthly(n, 0).seats)}/mo</td>
                  <td className="py-3">{(PLAN.includedPerAgent * n).toLocaleString("en-US")} a month</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Link href="/compare" className="link w-max text-sm font-medium text-accent">See what the same teams pay on Zendesk, Fin, Help Scout and others</Link>
      </section>

      <section data-play="" suppressHydrationWarning aria-labelledby="included" className="grid gap-6 md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <h2 id="included" className="ink font-display text-3xl">In every seat</h2>
        <ul className="grid gap-3">
          {SELLING_POINTS.map((p, i) => (
            <li key={p.slug} style={{ "--i": i } as React.CSSProperties} className="ln grid gap-1 border-b border-line pb-3">
              <Link href={`/features/${p.slug}`} className="link w-max font-medium">{p.name}</Link>
              <span className="text-muted">{p.short}</span>
            </li>
          ))}
        </ul>
      </section>

      <section data-play="" suppressHydrationWarning aria-labelledby="left-out" className="grid gap-6 md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <div className="grid content-start gap-3">
          <h2 id="left-out" className="ink font-display text-3xl">What it doesn&apos;t do</h2>
          <p className="text-muted">If you need any of these today, a bigger help desk is the better pick.</p>
        </div>
        <ul className="grid gap-3">
          {LEFT_OUT.map((it, i) => (
            <li key={it} style={{ "--i": i } as React.CSSProperties} className="ln flex gap-2.5 border-b border-line pb-3">
              <svg viewBox="0 0 20 20" className="mt-1 size-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M5 10h10" /></svg>
              {it}
            </li>
          ))}
        </ul>
      </section>

      <Faq items={FAQ} />
    </div>
  );
}
