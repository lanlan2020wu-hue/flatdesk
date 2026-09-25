import Link from "next/link";
import WaitlistForm from "@/components/WaitlistForm";
import { PLAN, competitorById, competitorMonthly, flatdeskMonthly, usd } from "@/lib/pricing";

const EXAMPLE = { agents: 10, resolutions: 1500 };

export default function Home() {
  const fin = competitorMonthly(competitorById("fin-advanced"), EXAMPLE.agents, EXAMPLE.resolutions);
  const ours = flatdeskMonthly(EXAMPLE.agents, EXAMPLE.resolutions);

  return (
    <div className="mx-auto grid max-w-5xl gap-16 px-4 py-12">
      <section className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-center">
        <div className="grid gap-5">
          <p className="num text-xs uppercase tracking-widest text-muted">Help desk for teams of 5–20 agents</p>
          <h1 className="font-display text-4xl leading-tight sm:text-5xl">
            {usd(PLAN.seatPrice)} per agent. AI included. The same bill every month.
          </h1>
          <p className="max-w-xl text-lg text-muted">
            Every seat includes {PLAN.includedPerAgent} AI resolutions a month, shared across your team. When they run out, the AI pauses and
            your team takes over. You only pay more if you turn overage on yourself.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/calculator" className="rounded-md bg-accent px-4 py-2 font-medium text-accent-ink">
              Compare your current bill
            </Link>
            <Link href="/pricing" className="rounded-md border border-line bg-surface px-4 py-2">
              See pricing
            </Link>
          </div>
        </div>

        <figure className="num grid gap-1 rounded-xl border border-dashed border-line bg-surface p-5 text-sm">
          <figcaption className="mb-2 font-sans text-muted">A 10-agent team with 1,500 AI resolutions a month</figcaption>
          <div className="flex justify-between gap-4"><span>Fin Advanced, seats</span><span>{usd(fin.seats)}</span></div>
          <div className="flex justify-between gap-4"><span>Fin outcomes, 1,500 × $0.99</span><span>{usd(fin.ai)}</span></div>
          <div className="mb-3 flex justify-between gap-4 border-t border-line pt-2 font-medium"><span>Fin total</span><span>{usd(fin.total)}</span></div>
          <div className="flex justify-between gap-4"><span>Flatdesk, 10 × {usd(PLAN.seatPrice)}</span><span>{usd(ours.seats)}</span></div>
          <div className="flex justify-between gap-4 text-muted"><span>1,000 AI resolutions</span><span>included</span></div>
          <div className="flex justify-between gap-4 text-muted"><span>500 more, if you turn overage on</span><span>{usd(ours.withOverage - ours.seats)}</span></div>
          <div className="flex justify-between gap-4 border-t border-line pt-2 font-medium text-accent"><span>Flatdesk total</span><span>{usd(ours.capped)}–{usd(ours.withOverage)}</span></div>
          <p className="mt-2 font-sans text-xs text-muted">Fin list prices with annual billing, checked Sep 2026.</p>
        </figure>
      </section>

      <section className="grid gap-6 sm:grid-cols-3">
        {[
          ["One number on the invoice", `Seats × ${usd(PLAN.seatPrice)}. No meters, no add-on tiers, no "contact sales".`],
          ["A cap that's on by default", `AI stops at your included resolutions unless an admin opts in to ${usd(PLAN.overageRate, true)} each. We never turn it on for you.`],
          ["Leave whenever you like", "Export every ticket, customer and macro as CSV or JSON from settings, any time, without asking us."],
        ].map(([title, body]) => (
          <div key={title} className="grid content-start gap-2">
            <h2 className="font-medium">{title}</h2>
            <p className="text-muted">{body}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-3">
        <h2 className="font-display text-2xl">What the first release includes</h2>
        <ul className="grid gap-2 text-muted sm:grid-cols-2">
          <li>Shared inbox for email and a website chat widget, with assignment, statuses and internal notes</li>
          <li>Canned replies and simple rules, such as &quot;if tagged billing, assign to Sam&quot;</li>
          <li>AI that answers routine questions and drafts replies for your team</li>
          <li>One reporting dashboard: volume, response and resolution times, agent load</li>
          <li>Zendesk import of tickets, tags, macros and assignments, done for you</li>
        </ul>
      </section>

      <section id="waitlist" className="grid scroll-mt-8 gap-4 rounded-xl border border-line bg-surface p-6">
        <div className="grid gap-1">
          <h2 className="font-display text-2xl">Get early access</h2>
          <p className="text-muted">We&apos;re onboarding a small group of teams first. Early teams get 50% off for their first 12 months, and we run the Zendesk import for them.</p>
        </div>
        <WaitlistForm />
      </section>
    </div>
  );
}
