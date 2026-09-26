import Link from "next/link";
import WaitlistForm from "@/components/WaitlistForm";
import YearChart from "@/components/YearChart";
import { PLAN, competitorById, competitorMonthly, flatdeskMonthly, usd } from "@/lib/pricing";

const EXAMPLE = { agents: 10, resolutions: 1500 };

const PRINCIPLES: [string, string, React.ReactNode][] = [
  [
    "One number on the invoice",
    `Seats × ${usd(PLAN.seatPrice)}. No meters, no add-on tiers, no "contact sales".`,
    <path key="i" d="M7 4h10v16l-2.5-1.5L12 20l-2.5-1.5L7 20zM10 9h4M10 13h4" />,
  ],
  [
    "A cap that's on by default",
    `AI stops at your included resolutions unless an admin opts in to ${usd(PLAN.overageRate, true)} each. We never turn it on for you.`,
    <path key="i" d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6zM9 12l2 2 4-4" />,
  ],
  [
    "Leave whenever you like",
    "Export every ticket, customer and macro as CSV or JSON from settings, any time, without asking us.",
    <path key="i" d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" />,
  ],
];

const INCLUDED = [
  "Shared inbox for email and a website chat widget, with assignment, statuses and internal notes",
  'Canned replies and simple rules, such as "if tagged billing, assign to Sam"',
  "AI that answers routine questions and drafts replies for your team",
  "One reporting dashboard: volume, response and resolution times, agent load",
  "Zendesk import of tickets, tags, macros and assignments, done for you",
];

function Row({ label, value, className = "" }: { label: React.ReactNode; value: React.ReactNode; className?: string }) {
  return (
    <div className={`flex justify-between gap-4 ${className}`}>
      <span>{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

export default function Home() {
  const fin = competitorMonthly(competitorById("fin-advanced"), EXAMPLE.agents, EXAMPLE.resolutions);
  const ours = flatdeskMonthly(EXAMPLE.agents, EXAMPLE.resolutions);

  return (
    <div className="grid gap-24 sm:gap-28">
      <section className="relative overflow-hidden">
        <div className="dots pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-4 pt-14 pb-4 sm:px-6 sm:pt-20 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-center lg:gap-16">
          <div className="grid gap-6">
            <p style={{ "--d": 0 } as React.CSSProperties} className="enter eyebrow flex w-max items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 shadow-sm">
              <span className="size-1.5 rounded-full bg-accent" />
              Help desk for teams of 5–20 agents
            </p>
            <h1 style={{ "--d": 1 } as React.CSSProperties} className="enter font-display text-[2.6rem] leading-[1.05] sm:text-6xl">
              {usd(PLAN.seatPrice)} per agent. AI included. <span className="hl italic">The same bill every month.</span>
            </h1>
            <p style={{ "--d": 2 } as React.CSSProperties} className="enter max-w-xl text-lg text-muted">
              Every seat includes {PLAN.includedPerAgent} AI resolutions a month, shared across your team. When they run out, the AI pauses and
              your team takes over. You only pay more if you turn overage on yourself.
            </p>
            <div style={{ "--d": 3 } as React.CSSProperties} className="enter flex flex-wrap gap-3">
              <Link href="/calculator" className="btn btn-primary">
                Compare your current bill
                <span aria-hidden="true" className="arrow">→</span>
              </Link>
              <Link href="/pricing" className="btn btn-secondary">
                See pricing
              </Link>
            </div>
          </div>

          <figure className="receipt-shadow relative mx-auto w-full max-w-md lg:rotate-[1.2deg]">
            <div className="print receipt num grid gap-1.5 px-6 pt-8 pb-9 text-[13px] sm:px-7">
              <figcaption className="mb-3 grid gap-1 text-center font-sans">
                <span className="eyebrow">Monthly bill</span>
                <span className="text-sm text-muted">A 10-agent team with 1,500 AI resolutions a month</span>
              </figcaption>
              <div className="rule-dashed mb-2" />
              <Row label="Fin Advanced, seats" value={usd(fin.seats)} />
              <Row label="Fin outcomes, 1,500 × $0.99" value={usd(fin.ai)} />
              <Row label="Fin total" value={usd(fin.total)} className="mt-1 border-t border-line pt-2 font-medium" />
              <div className="rule-dashed my-3" />
              <Row label={`Flatdesk, 10 × ${usd(PLAN.seatPrice)}`} value={usd(ours.seats)} />
              <Row label="1,000 AI resolutions" value="included" className="text-muted" />
              <Row label="500 more, if you turn overage on" value={usd(ours.withOverage - ours.seats)} className="text-muted" />
              <div className="mt-2 flex items-baseline justify-between gap-4 rounded-lg bg-accent-soft px-3 py-2.5 font-medium text-accent">
                <span>Flatdesk total</span>
                <span className="text-base">{usd(ours.capped)}–{usd(ours.withOverage)}</span>
              </div>
              <p className="mt-3 text-center font-sans text-xs text-muted">Fin list prices with annual billing, checked Sep 2026.</p>
            </div>
            <span
              aria-hidden="true"
              className="stamp absolute -top-3 -right-2 rotate-12 rounded-md border-2 border-accent bg-surface px-2 py-0.5 font-mono text-[11px] font-medium tracking-[0.2em] text-accent uppercase shadow-sm"
            >
              Flat
            </span>
          </figure>
        </div>
      </section>

      <section className="reveal mx-auto grid w-full max-w-6xl gap-6 px-4 sm:px-6 md:grid-cols-3">
        {PRINCIPLES.map(([title, body, icon], i) => (
          <div key={title} className="lift card grid content-start gap-3 p-6">
            <div className="flex items-center justify-between">
              <svg viewBox="0 0 24 24" className="size-9 rounded-lg bg-accent-soft p-2 text-accent" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {icon}
              </svg>
              <span className="num text-xs text-muted">0{i + 1}</span>
            </div>
            <h2 className="text-lg font-medium">{title}</h2>
            <p className="text-muted">{body}</p>
          </div>
        ))}
      </section>

      <section className="reveal mx-auto grid w-full max-w-6xl gap-8 px-4 sm:px-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:items-center">
        <div className="grid gap-3">
          <p className="eyebrow">Why flat matters</p>
          <h2 className="font-display text-3xl sm:text-4xl">Per-resolution pricing follows your busiest month.</h2>
          <p className="text-muted">
            When AI is billed per conversation, a launch or a holiday rush shows up on the invoice. With Flatdesk the bill is your seat count,
            and the cap is on unless you change it.
          </p>
          <Link href="/calculator" className="link w-max text-sm font-medium text-accent">Try it with your numbers</Link>
        </div>
        <YearChart />
      </section>

      <section className="reveal mx-auto grid w-full max-w-6xl gap-8 px-4 sm:px-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <div className="grid content-start gap-3">
          <p className="eyebrow">First release</p>
          <h2 className="font-display text-3xl sm:text-4xl">What the first release includes</h2>
        </div>
        <ul className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {INCLUDED.map((item) => (
            <li key={item} className="flex gap-3 border-t border-line pt-4">
              <svg viewBox="0 0 20 20" className="mt-0.5 size-5 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 10.5l3 3 7-7" />
              </svg>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section id="waitlist" className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 sm:px-6">
        <div className="reveal card relative grid gap-6 overflow-hidden p-6 shadow-lg sm:p-10">
          <div
            className="pointer-events-none absolute -top-40 -right-32 size-96 rounded-full bg-accent/15 blur-3xl"
            aria-hidden="true"
          />
          <div className="relative grid max-w-2xl gap-2">
            <p className="eyebrow">Early access</p>
            <h2 className="font-display text-3xl sm:text-4xl">Get early access</h2>
            <p className="text-muted">
              We&apos;re onboarding a small group of teams first. Early teams get <span className="hl text-ink">50% off for their first 12 months</span>, and we run
              the Zendesk import for them.
            </p>
          </div>
          <div className="relative">
            <WaitlistForm />
          </div>
        </div>
      </section>
    </div>
  );
}
