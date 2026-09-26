import Link from "next/link";
import WaitlistForm from "@/components/WaitlistForm";
import YearChart from "@/components/YearChart";
import { AiShot, ChatShot, FeatureIcon, ImportShot, InboxShot, MacroShot, ReceiptShot, ReportShot } from "@/components/ProductShots";
import { FEATURE_GROUPS } from "@/lib/features";
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

const SOURCES = ["Zendesk", "Intercom", "Freshdesk", "Help Scout"];

// The feature tour: one row per system, each with a drawing of the real screen.
const TOUR: { eyebrow: string; title: string; body: string; points: string[]; shot: React.ReactNode; badge?: string }[] = [
  {
    eyebrow: "Shared inbox",
    title: "Email and chat land in one queue.",
    body: "Forward your support address and add the chat widget. Every conversation becomes a ticket your whole team can see, assign and close.",
    points: ["Views for mine, unassigned, open, pending and closed", "Internal notes the customer never sees", "Replies thread back onto the same ticket"],
    shot: <InboxShot />,
  },
  {
    eyebrow: "Macros and rules",
    title: "Answer the same question once.",
    body: "Save replies as macros that can also tag the ticket and set its status. Rules route tagged tickets to the right person.",
    points: ['"If tagged billing, assign to Sam"', "Macros insert, tag and set status in one click", "Rules and macros come over from your old help desk"],
    shot: <MacroShot />,
  },
  {
    eyebrow: "AI answers",
    title: "AI takes the routine questions, and stops at your cap.",
    body: `The AI answers from your own macros and notes, and hands anything account-specific, upset or unclear to your team. Each seat includes ${PLAN.includedPerAgent} resolutions a month, pooled.`,
    points: ["Pauses at the included amount unless an admin opts in", "Emails admins at 80% and at 100%", "If the customer writes back, it doesn't count"],
    shot: <AiShot />,
  },
  {
    eyebrow: "AI receipts",
    badge: "New",
    title: "See every AI answer you're charged for. Refund the wrong ones.",
    body: "Each month gets an itemized statement: which tickets the AI answered, the saved answers it used, and whether each one counted. If the AI got one wrong, an admin refunds it in one click. It stops counting and the ticket goes back to your team.",
    points: ["Line by line, with the saved answers cited", "Refunds free up allowance and come off any overage", "Download the month as CSV"],
    shot: <ReceiptShot />,
  },
  {
    eyebrow: "Chat widget",
    title: "Live chat with one script tag.",
    body: "Paste one line into your site and a chat bubble appears. Visitors get answers from the AI or your team, in the same inbox as email.",
    points: ["Works on any site", "Chats become tickets with full history", "Uses the same AI allowance as email"],
    shot: <ChatShot />,
  },
  {
    eyebrow: "Reports",
    title: "The numbers a team lead actually checks.",
    body: "Ticket volume by channel, median first response, median time to close, the share the AI answered, and each agent's load.",
    points: ["Last 7, 30 or 90 days", "Per-agent replies, closed and open", "AI answered versus handed off"],
    shot: <ReportShot />,
  },
  {
    eyebrow: "Import and export",
    title: "Bring your history. Take it with you if you leave.",
    body: "Bring tickets, customers, macros, tags and rules from your current help desk. Every original record is archived, and anything that didn't map is listed. Export everything as CSV or JSON at any time.",
    points: SOURCES.map((s) => `Import from ${s}`),
    shot: <ImportShot />,
  },
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
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="ribbon enter-fade" />
        </div>
        <div className="gridlines pointer-events-none absolute inset-x-0 top-0 bottom-0 mx-auto max-w-6xl" aria-hidden="true" />
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
              <Link href="/sign-up" className="btn btn-primary">
                Start your free trial
                <span aria-hidden="true" className="arrow">→</span>
              </Link>
              <Link href="/calculator" className="btn btn-secondary">
                Compare your current bill
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

      <section aria-label="Import sources" className="-mt-12 border-y border-line bg-surface/60 sm:-mt-16">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-10 gap-y-3 px-4 py-6 sm:px-6">
          <p className="text-sm text-muted">Imports your history from</p>
          <ul className="flex flex-wrap items-center gap-x-10 gap-y-2">
            {SOURCES.map((s) => (
              <li key={s} className="font-display text-xl text-ink/70">{s}</li>
            ))}
          </ul>
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

      <section id="features" className="mx-auto grid w-full max-w-6xl scroll-mt-24 gap-16 px-4 sm:px-6 sm:gap-24">
        <div className="reveal grid max-w-2xl gap-3">
          <p className="eyebrow">The product</p>
          <h2 className="font-display text-4xl sm:text-5xl">Everything a support team runs on. One price per seat.</h2>
          <p className="text-lg text-muted">No add-on tiers and no feature gates. Every seat gets every system below.</p>
        </div>
        {TOUR.map((f, i) => (
          <article key={f.eyebrow} className="reveal grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
            <div className={`grid content-start gap-4 ${i % 2 ? "lg:order-2" : ""}`}>
              <p className="eyebrow flex items-center gap-2">
                <span className="num text-accent">{String(i + 1).padStart(2, "0")}</span>
                {f.eyebrow}
                {f.badge && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] tracking-[0.12em] text-accent-ink">{f.badge}</span>}
              </p>
              <h3 className="font-display text-3xl leading-tight">{f.title}</h3>
              <p className="text-muted">{f.body}</p>
              <ul className="grid gap-2 text-sm">
                {f.points.map((p) => (
                  <li key={p} className="flex gap-2.5">
                    <svg viewBox="0 0 20 20" className="mt-0.5 size-4 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 10.5l3 3 7-7" />
                    </svg>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
            <div className="relative">
              <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-accent-soft/70" aria-hidden="true" />
              {f.shot}
            </div>
          </article>
        ))}
      </section>

      <section className="reveal mx-auto grid w-full max-w-6xl gap-10 px-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid max-w-xl gap-3">
            <p className="eyebrow">Included in every seat</p>
            <h2 className="font-display text-3xl sm:text-4xl">The full list</h2>
          </div>
          <Link href="/pricing" className="link text-sm font-medium text-accent">See pricing</Link>
        </div>
        <div className="grid gap-x-10 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
          {FEATURE_GROUPS.map((g) => (
            <div key={g.id} className="grid content-start gap-4">
              <h3 className="eyebrow border-b border-line pb-2">{g.title}</h3>
              <ul className="grid gap-4">
                {g.features.map((f) => (
                  <li key={f.id} className="flex gap-3">
                    <FeatureIcon d={f.icon} className="size-8 bg-accent-soft p-1.5" />
                    <span className="grid gap-0.5">
                      <span className="font-medium">{f.title}</span>
                      <span className="text-sm text-muted">{f.body}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
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
          <div className="relative grid gap-4">
            <WaitlistForm />
            <p className="text-sm text-muted">
              Rather try it yourself first?{" "}
              <Link href="/sign-up" className="link font-medium text-accent">Start a free trial</Link>.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
