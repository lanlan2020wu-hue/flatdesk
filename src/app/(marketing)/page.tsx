import type { Metadata } from "next";
import Link from "next/link";
import JsonLd from "@/components/JsonLd";
import WaitlistForm from "@/components/WaitlistForm";
import YearChart from "@/components/YearChart";
import { AiShot, ImportShot, InboxShot, MacroShot, MacroUpdateShot, ReceiptShot, ReportShot } from "@/components/ProductShots";
import { organization, software, website } from "@/lib/seo";
import { PLAN, competitorById, competitorMonthly, flatdeskMonthly, usd } from "@/lib/pricing";

const EXAMPLE = { agents: 10, resolutions: 1500 };

// The page reads in the order Flatdesk is sold: the flat rate first, then AI
// macros, then everything else in the seat. Each chapter has its own anchor.
const CHAPTERS = [
  { id: "flat-rate", n: "01", title: "Flat rate", body: "One price per seat, AI included and capped." },
  { id: "ai-macros", n: "02", title: "AI macros", body: "Evolving macros that grow with your business and act on the ticket." },
  { id: "everything-else", n: "03", title: "Everything else", body: "AI answers, inbox and chat, import, reports." },
];

const SOURCES = ["Zendesk", "Intercom", "Freshdesk", "Help Scout"];

const MACRO_STEPS = [
  { title: "Flatdesk spots the repeats", body: "When the same answer has gone out on 5 tickets and no macro covers it, Flatdesk flags it. Imported history counts, so it works on day one." },
  { title: "The AI writes the macro", body: "From the versions your team sent, the AI writes a name, the customer question it answers, and one clean reply with placeholders for names and order numbers." },
  { title: "New tickets get it offered", body: "Save it, and when a new ticket asks the same thing, the reply box offers that macro. AI answers use your macros too." },
];

// What one macro does when an agent uses it. Zendesk macros also run actions,
// so this is shown as what's included, not as something only Flatdesk has.
const MACRO_ACTIONS = [
  { title: "Writes the reply", body: "With the customer's first name already filled in." },
  { title: "Assigns the ticket", body: "Refunds to Ana, bugs to your developer, whoever owns it." },
  { title: "Sets the status", body: "Closed, pending or open, once the reply goes out." },
  { title: "Adds tags", body: "So reports and assignment rules pick it up." },
  { title: "Sends right away", body: "For answers that need no checking, one click and it's sent." },
];

// Chapter three: the rest of the seat, in the order teams ask about it.
const TOUR: { id: string; eyebrow: string; title: string; body: string; points: string[]; shot: React.ReactNode; badge?: string; href?: string }[] = [
  {
    id: "ai",
    eyebrow: "AI answers",
    title: "AI takes the routine questions, and stops at your cap.",
    body: `The AI answers from your own macros and notes, and hands anything account-specific, upset or unclear to your team. Each seat includes ${PLAN.includedPerAgent} resolutions a month, pooled.`,
    points: ["Pauses at the included amount unless an admin opts in", "Emails admins at 80% and at 100%", "Try it first: the AI test drive drafts answers to 50 of your past tickets"],
    shot: <AiShot />,
    href: "/features/ai-test-drive",
  },
  {
    id: "inbox",
    eyebrow: "Shared inbox and chat",
    title: "Email and chat land in one queue.",
    body: "Forward your support address and paste one script tag for the chat bubble. Every conversation becomes a ticket your whole team can see, assign and close.",
    points: ["Views for mine, unassigned, open, pending and closed", "Internal notes the customer never sees", 'Rules like "if tagged billing, assign to Sam"'],
    shot: <InboxShot />,
  },
  {
    id: "import",
    eyebrow: "Lossless import and export",
    title: "Bring your whole history. Nothing is left behind.",
    body: "Bring tickets, customers, macros, tags and rules from your current help desk. Every original record is archived, anything that didn't map is listed in a report, and you can download the raw archive. Export everything as CSV or JSON at any time.",
    points: [...SOURCES.map((s) => `Import from ${s}`), "Export any time, without asking us"],
    shot: <ImportShot />,
    href: "/features/lossless-import",
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

// Smaller things in the seat, one line each, after the tour.
const MORE = [
  { title: "Live chat widget", body: "One script tag. Chats become tickets.", href: "/features#all" },
  { title: "Help center", body: "Articles customers search and the AI links to.", href: "/features#all" },
  { title: "AI test drive", body: "AI drafts for your last 50 tickets, beside your team's replies.", href: "/features/ai-test-drive" },
  { title: "Slack alerts, targets, ratings", body: "First-reply targets, one-click ratings, alerts when a person is needed.", href: "/features#all" },
];

const check = (
  <svg viewBox="0 0 20 20" className="mt-0.5 size-4 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 10.5l3 3 7-7" />
  </svg>
);

function Row({ label, value, className = "" }: { label: React.ReactNode; value: React.ReactNode; className?: string }) {
  return (
    <div className={`flex justify-between gap-4 ${className}`}>
      <span>{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function ChapterHead({ n, eyebrow, title, children }: { n: string; eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <div data-play="" className="grid max-w-3xl gap-3">
      <p className="eyebrow flex items-center gap-3">
        <span className="num font-display text-3xl text-accent">{n}</span>
        {eyebrow}
      </p>
      <h2 className="ink font-display text-4xl leading-tight sm:text-5xl">{title}</h2>
      {children && <p className="text-lg text-muted">{children}</p>}
    </div>
  );
}

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default function Home() {
  const fin = competitorMonthly(competitorById("fin-advanced"), EXAMPLE.agents, EXAMPLE.resolutions);
  const ours = flatdeskMonthly(EXAMPLE.agents, EXAMPLE.resolutions, "year");

  return (
    <div className="grid gap-24 sm:gap-32">
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
              One flat rate for your whole help desk. <span className="hl hl-draw font-display-italic italic">The same bill every month.</span>
            </h1>
            <p style={{ "--d": 2 } as React.CSSProperties} className="enter max-w-xl text-lg text-muted">
              {usd(PLAN.annualSeatPrice)} per agent billed yearly, or {usd(PLAN.seatPrice)} month to month, with {PLAN.includedPerAgent} AI resolutions per seat
              included and capped. No AI meter, no add-ons. And evolving AI macros: written from your team&apos;s replies, updated as your business changes, and able to reply, assign and close a ticket in one click.
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

      <nav aria-label="On this page" className="-mt-12 border-y border-line bg-surface/60 sm:-mt-20">
        <ol className="mx-auto grid max-w-6xl sm:grid-cols-3">
          {CHAPTERS.map((c, i) => (
            <li key={c.id} className={i ? "border-t border-line sm:border-t-0 sm:border-l" : ""}>
              <a href={`#${c.id}`} className="group flex items-baseline gap-3 px-4 py-5 transition-colors hover:bg-surface sm:px-6">
                <span className="num font-display text-2xl text-accent/60 group-hover:text-accent">{c.n}</span>
                <span className="grid gap-0.5">
                  <span className="font-medium">{c.title}</span>
                  <span className="text-sm text-muted">{c.body}</span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <section id="flat-rate" className="mx-auto grid w-full max-w-6xl scroll-mt-24 gap-12 px-4 sm:px-6">
        <ChapterHead n="01" eyebrow="Flat rate" title="Per-resolution pricing follows your busiest month. Flatdesk doesn't.">
          When AI is billed per conversation, a launch or a holiday rush shows up on the invoice. With Flatdesk the bill is your seat count, and the cap is on
          unless you change it.
        </ChapterHead>
        <div data-play="" className="grid gap-4">
          <dl className="card grid gap-6 border-accent/30 bg-accent-soft/40 p-6 sm:grid-cols-3 sm:p-8">
            <div className="grid content-start gap-1">
              <dt className="text-sm text-muted">Per agent, billed yearly</dt>
              <dd className="num font-display text-5xl">{usd(PLAN.annualSeatPrice)}<span className="text-lg text-muted"> / month</span></dd>
              <dd className="text-sm text-muted">or {usd(PLAN.seatPrice)} month to month</dd>
            </div>
            <div className="grid content-start gap-1">
              <dt className="text-sm text-muted">AI resolutions included</dt>
              <dd className="num font-display text-5xl">{PLAN.includedPerAgent}<span className="text-lg text-muted"> per seat</span></dd>
              <dd className="text-sm text-muted">Pooled across the team. At the cap the AI pauses; overage ({usd(PLAN.overageRate, true)} each) only if an admin turns it on.</dd>
            </div>
            <div className="grid content-start gap-1">
              <dt className="text-sm text-muted">Add-ons and tiers</dt>
              <dd className="num font-display text-5xl">0</dd>
              <dd className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                <Link href="/pricing" className="link font-medium text-accent">See pricing</Link>
                <Link href="/calculator" className="link font-medium text-accent">Try it with your numbers</Link>
              </dd>
            </div>
          </dl>
          <YearChart />
        </div>
        <article className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
          <div data-play="" className="grid content-start gap-4">
            <p className="eyebrow">AI receipts</p>
            <h3 className="ink font-display text-3xl leading-tight">See every AI answer you&apos;re charged for. Refund the wrong ones.</h3>
            <p className="text-muted">
              Each month gets an itemized statement: which tickets the AI answered, the saved answers it used, and whether each one counted. If the AI got one
              wrong, an admin refunds it in one click. It stops counting and the ticket goes back to your team.
            </p>
            <ul className="grid gap-2 text-sm">
              {["No tiers and no add-ons: every seat gets every feature", "Refunds free up allowance and come off any overage", "Download the month as CSV"].map((p) => (
                <li key={p} className="flex gap-2.5">{check}{p}</li>
              ))}
            </ul>
          </div>
          <div data-play="" className="relative">
            <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-accent-soft/70" aria-hidden="true" />
            <ReceiptShot />
          </div>
        </article>
      </section>

      <section id="ai-macros" className="scroll-mt-24 border-y border-accent/20 bg-accent-soft/40 py-20 sm:py-28">
        <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 sm:px-6">
          <ChapterHead n="02" eyebrow="AI macros" title="Evolving macros that scale with your business.">
            Flatdesk identifies the answers your team keeps typing and the AI turns each one into a macro. As your products, prices and policies change, the
            macros change with them, learned from how your team edits them. And each macro does the work around the reply too. It&apos;s included in the seat
            and never uses your AI allowance.
          </ChapterHead>
          <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-16">
            <div data-play="" className="relative">
              <MacroShot />
            </div>
            <ol data-play="" className="grid gap-6">
              {MACRO_STEPS.map((step, i) => (
                <li key={step.title} style={{ "--i": i } as React.CSSProperties} className="ln flex gap-4">
                  <span className="num flex size-9 shrink-0 items-center justify-center rounded-full bg-accent font-medium text-accent-ink">{i + 1}</span>
                  <span className="grid gap-1">
                    <span className="font-display text-xl">{step.title}</span>
                    <span className="text-muted">{step.body}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div data-play="" className="grid gap-6">
            <h3 className="ink font-display text-3xl leading-tight">One macro does the whole job, not just the words.</h3>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {MACRO_ACTIONS.map((a, i) => (
                <li key={a.title} style={{ "--i": i } as React.CSSProperties} className="ln card grid content-start gap-1.5 p-5">
                  <span className="num font-display text-2xl text-accent">{String(i + 1).padStart(2, "0")}</span>
                  <span className="font-medium">{a.title}</span>
                  <span className="text-sm text-muted">{a.body}</span>
                </li>
              ))}
            </ul>
          </div>
          <article className="grid items-center gap-10 rounded-3xl border border-accent/30 bg-surface p-6 shadow-sm sm:p-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
            <div data-play="" className="grid content-start gap-4">
              <p className="eyebrow flex items-center gap-2">
                Evolving macros
                <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] tracking-[0.12em] text-accent-ink">New</span>
              </p>
              <h3 className="ink font-display text-3xl leading-tight">Your business changes. Your macros keep up on their own.</h3>
              <p className="text-muted">
                A new shipping time, a changed refund policy, a step that no longer applies: your team fixes it by hand in the reply first. Flatdesk sees when most
                sends make the same edit, and the AI rewrites the macro with it. An admin applies it in one click, so the macros grow with the business.
              </p>
              <ul className="grid gap-2 text-sm">
                {["Counts only sends of the current version, so one fix starts the count again", "Keeps your placeholders, greeting and sign-off", "Zendesk's macro suggestions cover new macros only"].map((p) => (
                  <li key={p} className="flex gap-2.5">{check}{p}</li>
                ))}
              </ul>
              <Link href="/features/ai-macros" className="link w-max text-sm font-medium text-accent">How AI macros work</Link>
            </div>
            <div data-play="">
              <MacroUpdateShot />
            </div>
          </article>
        </div>
      </section>

      <section id="everything-else" className="mx-auto grid w-full max-w-6xl scroll-mt-24 gap-16 px-4 sm:px-6 sm:gap-24">
        <ChapterHead n="03" eyebrow="Everything else" title="Everything else a support team runs on, in the same seat.">
          No add-on tiers and no feature gates. Every seat gets all of it.
        </ChapterHead>
        {TOUR.map((f, i) => (
          <article key={f.id} id={f.id} className="grid scroll-mt-24 items-center gap-8 lg:grid-cols-2 lg:gap-16">
            <div data-play="" className={`grid content-start gap-4 ${i % 2 ? "lg:order-2" : ""}`}>
              <p className="eyebrow flex items-center gap-2">
                {f.eyebrow}
                {f.badge && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] tracking-[0.12em] text-accent-ink">{f.badge}</span>}
              </p>
              <h3 className="ink font-display text-3xl leading-tight">{f.title}</h3>
              <p className="text-muted">{f.body}</p>
              <ul className="grid gap-2 text-sm">
                {f.points.map((p) => (
                  <li key={p} className="flex gap-2.5">{check}{p}</li>
                ))}
              </ul>
              {f.href && <Link href={f.href} className="link w-max text-sm font-medium text-accent">Learn more</Link>}
            </div>
            <div data-play="" className="relative">
              <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-surface-2/70" aria-hidden="true" />
              {f.shot}
            </div>
          </article>
        ))}
        <div data-play="" className="grid gap-4">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {MORE.map((m, i) => (
              <li key={m.title} style={{ "--i": i } as React.CSSProperties}>
                <Link href={m.href} className="flex h-full flex-col gap-0.5 rounded-xl border border-line bg-surface px-4 py-3 text-sm transition-colors hover:border-line-strong">
                  <span className="font-medium">{m.title}</span>
                  <span className="text-muted">{m.body}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/features#all" className="link w-max text-sm font-medium text-accent">See every feature</Link>
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
