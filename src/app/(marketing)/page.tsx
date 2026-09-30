import type { Metadata } from "next";
import Link from "next/link";
import JsonLd from "@/components/JsonLd";
import WaitlistForm from "@/components/WaitlistForm";
import YearChart from "@/components/YearChart";
import { AiShot, ChatShot, CopilotShot, FeatureIcon, ImportShot, InboxShot, MacroShot, ReceiptShot, ReportShot } from "@/components/ProductShots";
import { COPILOT } from "@/lib/copilot-config";
import { FEATURE_GROUPS } from "@/lib/features";
import { organization, software, website } from "@/lib/seo";
import { PLAN, competitorById, competitorMonthly, flatdeskMonthly, usd } from "@/lib/pricing";

const EXAMPLE = { agents: 10, resolutions: 1500 };

// The three things every seat is built around, right under the hero. Each
// links to its own feature page.
const PILLARS: { n: string; title: string; body: string; points: string[]; href: string; icon: string; isNew?: boolean }[] = [
  {
    n: "01",
    title: "One flat rate",
    body: `${usd(PLAN.annualSeatPrice)} per agent billed yearly, or ${usd(PLAN.seatPrice)} monthly. Every feature, ${PLAN.includedPerAgent} AI resolutions per seat, and a cap that's on unless you turn it off.`,
    points: ["No AI meter running up the bill", "No tiers, no add-ons", "Refund a wrong AI answer from its receipt"],
    href: "/features/flat-pricing",
    icon: "M7 4h10v16l-2.5-1.5L12 20l-2.5-1.5L7 20zM10 9h4M10 13h4",
  },
  {
    n: "02",
    title: "AI macros",
    body: "Flatdesk identifies the answers your team keeps retyping, and the AI writes each one up as a clean macro. New tickets that ask the same thing get it offered in one click.",
    points: ["Identified from your own replies, imported history too", "Written by AI, with placeholders for customer details", "Never uses your AI allowance"],
    href: "/features/ai-macros",
    icon: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z",
    isNew: true,
  },
  {
    n: "03",
    title: "AI copilot, included",
    body: "Every agent can summarize a ticket, draft a reply from your macros and help center, or rewrite what they typed. Zendesk sells its copilot as a paid add-on. Here it's in the seat.",
    points: ["Summary, customer mood and next step", "Drafts that cite your own answers", `${COPILOT.perAgent} actions per seat a month, pooled`],
    href: "/features/ai-copilot",
    icon: "M4 6h16v10H8l-4 4zM8 10h8M8 13h5",
    isNew: true,
  },
];

// Also in every seat: the reasons teams switched before, one line each.
const ALSO = [
  { title: "AI receipts", body: "Every AI answer itemized. Refund a wrong one.", href: "/features/ai-receipts" },
  { title: "AI test drive", body: "AI drafts for your last 50 tickets, beside your team's replies.", href: "/features/ai-test-drive" },
  { title: "Lossless import", body: "Zendesk, Intercom, Freshdesk, Help Scout. Nothing dropped.", href: "/features/lossless-import" },
];

const SOURCES = ["Zendesk", "Intercom", "Freshdesk", "Help Scout"];

// The feature tour: one row per system, each with a drawing of the real screen.
// The selling points come first.
const TOUR: { id: string; eyebrow: string; title: string; body: string; points: string[]; shot: React.ReactNode; badge?: string }[] = [
  {
    id: "macros",
    eyebrow: "AI macros",
    badge: "New",
    title: "Your team answers it five times. The AI writes the macro.",
    body: "Flatdesk identifies the answers your team keeps typing. Once the same reply has gone out on 5 tickets, the AI writes it up from the versions your team sent: a name, the question it answers, and one clean reply with placeholders. Save it, and every new ticket that asks the same thing gets it offered in the reply box.",
    points: [
      "Works from your imported history, so AI macros start on day one",
      "Offered on new tickets that ask the same question",
      "AI answers use your macros too, and none of this uses your AI allowance",
    ],
    shot: <MacroShot />,
  },
  {
    id: "copilot",
    eyebrow: "AI copilot",
    badge: "Included",
    title: "A copilot for every agent, in the seat you already pay for.",
    body: "Open a ticket and the copilot tells you what the customer wants, how they feel and what to do next. One click drafts the reply from your macros, notes and help center; another makes it shorter, friendlier or more formal. Nothing is sent until you send it.",
    points: ["Summaries that update when the customer writes again", "Placeholders, never made-up order numbers or policies", "Doesn't use AI resolutions"],
    shot: <CopilotShot />,
  },
  {
    id: "receipts",
    eyebrow: "AI receipts",
    badge: "New",
    title: "See every AI answer you're charged for. Refund the wrong ones.",
    body: "Each month gets an itemized statement: which tickets the AI answered, the saved answers it used, and whether each one counted. If the AI got one wrong, an admin refunds it in one click. It stops counting and the ticket goes back to your team.",
    points: ["Line by line, with the saved answers cited", "Refunds free up allowance and come off any overage", "Download the month as CSV"],
    shot: <ReceiptShot />,
  },
  {
    id: "import",
    eyebrow: "Lossless import and export",
    title: "Bring your whole history. Nothing is left behind.",
    body: "Bring tickets, customers, macros, tags and rules from your current help desk. Every original record is archived, anything that didn't map is listed in a report, and you can download the raw archive. Export everything as CSV or JSON at any time.",
    points: [...SOURCES.map((s) => `Import from ${s}`), "Export any time, without asking us"],
    shot: <ImportShot />,
  },
  {
    id: "inbox",
    eyebrow: "Shared inbox",
    title: "Email and chat land in one queue.",
    body: "Forward your support address and add the chat widget. Every conversation becomes a ticket your whole team can see, assign and close.",
    points: ["Views for mine, unassigned, open, pending and closed", "Internal notes the customer never sees", 'Rules like "if tagged billing, assign to Sam"'],
    shot: <InboxShot />,
  },
  {
    id: "ai",
    eyebrow: "AI answers",
    title: "AI takes the routine questions, and stops at your cap.",
    body: `The AI answers from your own macros and notes, and hands anything account-specific, upset or unclear to your team. Each seat includes ${PLAN.includedPerAgent} resolutions a month, pooled.`,
    points: ["Pauses at the included amount unless an admin opts in", "Emails admins at 80% and at 100%", "Answers up to 3 follow-ups; hand-offs don't count"],
    shot: <AiShot />,
  },
  {
    id: "chat",
    eyebrow: "Chat widget",
    title: "Live chat with one script tag.",
    body: "Paste one line into your site and a chat bubble appears. Visitors get answers from the AI or your team, in the same inbox as email.",
    points: ["Works on any site", "Chats become tickets with full history", "Uses the same AI allowance as email"],
    shot: <ChatShot />,
  },
  {
    id: "reports",
    eyebrow: "Reports",
    title: "The numbers a team lead actually checks.",
    body: "Ticket volume by channel, median first response, median time to close, the share the AI answered, and each agent's load.",
    points: ["Last 7, 30 or 90 days", "Per-agent replies, closed and open", "AI answered versus handed off"],
    shot: <ReportShot />,
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

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default function Home() {
  const fin = competitorMonthly(competitorById("fin-advanced"), EXAMPLE.agents, EXAMPLE.resolutions);
  const ours = flatdeskMonthly(EXAMPLE.agents, EXAMPLE.resolutions, "year");

  return (
    <div className="grid gap-24 sm:gap-28">
      <JsonLd data={[organization(), website(), software()]} />
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="ribbon enter-fade" />
        </div>
        <div className="gridlines pointer-events-none absolute inset-x-0 top-0 bottom-0 mx-auto max-w-6xl" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-4 pt-14 pb-4 sm:px-6 sm:pt-20 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-center lg:gap-16">
          <div className="grid gap-6">
            <p style={{ "--d": 0 } as React.CSSProperties} className="enter eyebrow flex w-max items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 shadow-sm">
              <span className="size-1.5 rounded-full bg-accent" />
              Help desk for teams of 3–15 agents
            </p>
            <h1 style={{ "--d": 1 } as React.CSSProperties} className="enter font-display text-[2.6rem] leading-[1.05] sm:text-6xl">
              One flat rate. AI macros and a copilot included. <span className="hl hl-draw font-display-italic italic">The same bill every month.</span>
            </h1>
            <p style={{ "--d": 2 } as React.CSSProperties} className="enter max-w-xl text-lg text-muted">
              {usd(PLAN.annualSeatPrice)} per agent billed yearly, or {usd(PLAN.seatPrice)} month to month. Flatdesk spots the answers your team keeps
              retyping and the AI turns them into macros. Every agent gets an AI copilot to summarize, draft and rewrite. And{" "}
              {PLAN.includedPerAgent} AI resolutions per seat are included and capped, so the bill never runs away.
            </p>
            <p style={{ "--d": 2 } as React.CSSProperties} className="enter flex flex-wrap gap-2 text-sm">
              {["Flat rate, no AI meter", "AI macros", "AI copilot in every seat"].map((t) => (
                <span key={t} className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 shadow-sm">
                  <svg viewBox="0 0 20 20" className="size-3.5 text-accent" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 10.5l3 3 7-7" /></svg>
                  {t}
                </span>
              ))}
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
            <p style={{ "--d": 3 } as React.CSSProperties} className="enter text-sm text-muted">
              Small team moving off Zendesk or Freshdesk?{" "}
              <a href="#waitlist" className="link font-medium text-accent">Apply as a design partner</a> for half off and a done-for-you import.
            </p>
          </div>

          <figure data-play="" className="receipt-shadow relative mx-auto w-full max-w-md lg:rotate-[1.2deg]">
            <span aria-hidden="true" className="printer-slot" />
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
              <Row label={`Flatdesk, 10 × ${usd(PLAN.annualSeatPrice)}`} value={usd(ours.seats)} />
              <Row label="1,000 AI resolutions" value="included" className="text-muted" />
              <Row label="500 more, if you turn overage on" value={usd(ours.withOverage - ours.seats)} className="text-muted" />
              <div className="mt-2 flex items-baseline justify-between gap-4 rounded-lg bg-accent-soft px-3 py-2.5 font-medium text-accent">
                <span>Flatdesk total</span>
                <span className="text-base">{usd(ours.capped)}–{usd(ours.withOverage)}</span>
              </div>
              <p className="mt-3 text-center font-sans text-xs text-muted">Both with annual billing, Fin at list price checked Sep 2026.</p>
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

      <section data-play="" aria-labelledby="why-switch" className="mx-auto grid w-full max-w-6xl gap-8 px-4 sm:px-6">
        <div className="grid max-w-2xl gap-3">
          <p className="eyebrow">In every seat</p>
          <h2 id="why-switch" className="ink font-display text-3xl sm:text-4xl">One price. Two kinds of AI that save your team typing.</h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {PILLARS.map((p, i) => (
            <Link key={p.title} href={p.href} style={{ "--i": i } as React.CSSProperties} className={`lift card group flex flex-col gap-4 p-6 sm:p-7 ${i === 0 ? "border-accent/40 bg-accent-soft/40" : ""}`}>
              <span className="flex items-center justify-between">
                <FeatureIcon d={p.icon} className="size-11 bg-accent-soft p-2.5" />
                <span className="flex items-center gap-2">
                  {p.isNew && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium tracking-[0.12em] text-accent-ink uppercase">New</span>}
                  <span className="num font-display text-2xl text-accent/60">{p.n}</span>
                </span>
              </span>
              <span className="font-display text-2xl">{p.title}</span>
              <span className="text-muted">{p.body}</span>
              <ul className="grid gap-2 border-t border-line pt-4 text-sm">
                {p.points.map((t) => (
                  <li key={t} className="flex gap-2.5">
                    <svg viewBox="0 0 20 20" className="mt-0.5 size-4 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 10.5l3 3 7-7" /></svg>
                    {t}
                  </li>
                ))}
              </ul>
              <span className="mt-auto text-sm font-medium text-accent">
                How it works <span aria-hidden="true" className="arrow inline-block transition-transform group-hover:translate-x-0.5">→</span>
              </span>
            </Link>
          ))}
        </div>
        <ul className="grid gap-3 sm:grid-cols-3">
          {ALSO.map((a) => (
            <li key={a.title}>
              <Link href={a.href} className="flex h-full flex-col gap-0.5 rounded-xl border border-line px-4 py-3 text-sm transition-colors hover:border-line-strong">
                <span className="font-medium">{a.title}</span>
                <span className="text-muted">{a.body}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section id="why-flat" data-play="" className="mx-auto grid w-full max-w-6xl scroll-mt-24 gap-8 px-4 sm:px-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:items-center">
        <div className="grid gap-3">
          <p className="eyebrow">Why flat matters</p>
          <h2 className="ink font-display text-3xl sm:text-4xl">Per-resolution pricing follows your busiest month.</h2>
          <p className="text-muted">
            When AI is billed per conversation, a launch or a holiday rush shows up on the invoice. With Flatdesk the bill is your seat count,
            and the cap is on unless you change it.
          </p>
          <Link href="/calculator" className="link w-max text-sm font-medium text-accent">Try it with your numbers</Link>
        </div>
        <YearChart />
      </section>

      <section id="features" className="mx-auto grid w-full max-w-6xl scroll-mt-24 gap-16 px-4 sm:px-6 sm:gap-24">
        <div data-play="" className="grid max-w-2xl gap-3">
          <p className="eyebrow">The product</p>
          <h2 className="ink font-display text-4xl sm:text-5xl">Everything a support team runs on. One price per seat.</h2>
          <p className="text-lg text-muted">No add-on tiers and no feature gates. Every seat gets every system below, starting with the ones teams switch for.</p>
        </div>
        {TOUR.map((f, i) => (
          <article key={f.id} id={f.id} className="grid scroll-mt-24 items-center gap-8 lg:grid-cols-2 lg:gap-16">
            <div data-play="" className={`grid content-start gap-4 ${i % 2 ? "lg:order-2" : ""}`}>
              <p className="eyebrow flex items-center gap-2">
                <span className="num text-accent">{String(i + 1).padStart(2, "0")}</span>
                {f.eyebrow}
                {f.badge && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] tracking-[0.12em] text-accent-ink">{f.badge}</span>}
              </p>
              <h3 className="ink font-display text-3xl leading-tight">{f.title}</h3>
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
            <div data-play="" className="relative">
              <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-accent-soft/70" aria-hidden="true" />
              {f.shot}
            </div>
          </article>
        ))}
      </section>

      <section data-play="" className="mx-auto grid w-full max-w-6xl gap-10 px-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid max-w-xl gap-3">
            <p className="eyebrow">Included in every seat</p>
            <h2 className="ink font-display text-3xl sm:text-4xl">The full list</h2>
          </div>
          <Link href="/pricing" className="link text-sm font-medium text-accent">See pricing</Link>
        </div>
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

      <section id="waitlist" className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 sm:px-6">
        <div data-play="" className="card relative grid gap-6 overflow-hidden p-6 shadow-lg sm:p-10">
          <div
            className="pointer-events-none absolute -top-40 -right-32 size-96 rounded-full bg-accent/15 blur-3xl"
            aria-hidden="true"
          />
          <div className="relative grid max-w-2xl gap-2">
            <p className="eyebrow">Early access</p>
            <h2 className="ink font-display text-3xl sm:text-4xl">Get early access</h2>
            <p className="text-muted">
              We&apos;re onboarding a small group of design partners first. They get <span className="hl hl-draw text-ink">50% off monthly billing for their first 12 months</span>{" "}
              ({usd(PLAN.seatPrice / 2)} per agent), and we run the import from their old help desk for them. The discount replaces the yearly price rather than adding to it.
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
