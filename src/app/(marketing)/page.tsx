import type { Metadata } from "next";
import Link from "next/link";
import AddOnTable from "@/components/AddOnTable";
import JsonLd from "@/components/JsonLd";
import SwitchBill from "@/components/SwitchBill";
import WaitlistForm from "@/components/WaitlistForm";
import WhyFlat from "@/components/WhyFlat";
import YearChart from "@/components/YearChart";
import { AiShot, ImportShot, InboxShot, MacroShot, MacroUpdateShot, ReceiptShot, ReportShot } from "@/components/ProductShots";
import { TRIAL_DAYS } from "@/lib/billing";
import { organization, software, website } from "@/lib/seo";
import { PLAN, usd } from "@/lib/pricing";
import { LEFT_OUT } from "@/lib/why-flat";

// The page answers a visitor's reasons not to switch, in the order they come
// up: will my bill be lower (the hero shows their own), why is it flat and is
// it worse (flat rate), what is better (AI macros), is everything else there,
// is it for us, how do we move, and what do we risk.

const SOURCES = ["Zendesk", "Intercom", "Freshdesk", "Help Scout"];

// Under the hero: what switching costs you, before anyone asks.
const TERMS = [
  { title: `${TRIAL_DAYS} days free`, body: "No card to start. Every feature, on your real tickets." },
  { title: "Month to month", body: "No contract on monthly billing. Stop whenever you like." },
  { title: "Bring your history", body: `Tickets, customers and macros from ${SOURCES.slice(0, 3).join(", ")} or Help Scout.` },
  { title: "Take it with you", body: "Export every ticket and macro as CSV or JSON, any time." },
];

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
const TOUR: { id: string; title: string; body: string; points: string[]; shot: React.ReactNode; href?: string; more?: string }[] = [
  {
    id: "ai",
    title: "AI takes the routine questions, and stops at your cap.",
    body: `The AI answers from your own macros and notes, and hands anything account-specific, upset or unclear to your team. Each seat includes ${PLAN.includedPerAgent} resolutions a month, pooled.`,
    points: ["Pauses at the included amount unless an admin opts in", "Emails admins at 80% and at 100%", "Try it first: the AI test drive drafts answers to 50 of your past tickets"],
    shot: <AiShot />,
    href: "/features/ai-test-drive",
    more: "How the AI test drive works",
  },
  {
    id: "inbox",
    title: "Email and chat land in one queue.",
    body: "Forward your support address and paste one script tag for the chat bubble. Every conversation becomes a ticket your whole team can see, assign and close.",
    points: ["Views for mine, unassigned, open, pending and closed", "Internal notes the customer never sees", 'Rules like "if tagged billing, assign to Sam"'],
    shot: <InboxShot />,
  },
  {
    id: "reports",
    title: "Reports on volume, response times and what the AI handled.",
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

// The route from an old help desk to Flatdesk, in the order an admin does it.
const SWITCH_STEPS = [
  { title: "Import your history", body: `Paste an API key from ${SOURCES.join(", ")}. Tickets with their full threads, customers, macros, tags and rules come over.` },
  { title: "Point your email and chat", body: "Forward your support address and paste one script tag for the chat bubble. Forwarding can be pointed back any time." },
  { title: "Test drive the AI", body: "The AI drafts answers to your last 50 tickets, shown beside what your team sent. Nothing goes to customers." },
  { title: "Turn it on", body: "Switch AI answers on with the cap in place, invite the team, and cancel the old plan when you're ready." },
];

const mark = <span className="mt-[0.7em] h-[2px] w-3 shrink-0 bg-accent" aria-hidden="true" />;

// One line of a rate card: the label, a dotted leader, the figure.
function Rate({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-line py-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <span className="min-w-4 flex-1 translate-y-[-0.3em] border-b border-dotted border-line-strong" aria-hidden="true" />
      <dd className="text-right">{children}</dd>
    </div>
  );
}

// A chapter opens with a short tab carrying its name, like the tabbed divider
// in a ledger, then the headline that answers the worry.
function ChapterHead({ tab, title, children, id }: { tab: string; title: string; children?: React.ReactNode; id: string }) {
  return (
    <header data-play="" className="grid gap-5">
      <a href={`#${id}`} className="w-max rounded-t-[5px] border-x border-t border-ink/80 px-3 pt-1.5 pb-1 text-sm font-semibold">{tab}</a>
      <div className="grid gap-5 border-t-2 border-ink pt-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
        <h2 className="ink font-display text-4xl sm:text-[3.4rem]">{title}</h2>
        {children && <p className="max-w-[56ch] self-end text-lg text-muted">{children}</p>}
      </div>
    </header>
  );
}

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default function Home() {
  return (
    <div className="grid">
      <JsonLd data={[organization(), website(), software()]} />

      {/* The first screen: the headline on the bank-note green field, and the visitor's own two bills. */}
      <section className="bg-field text-field-ink">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 pt-14 pb-16 sm:px-6 sm:pt-20 sm:pb-24 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:items-center lg:gap-14">
          <div className="grid content-center gap-7">
            <h1 style={{ "--d": 1 } as React.CSSProperties} className="enter font-display text-[3.4rem] leading-[0.95] sm:text-[5.2rem]">
              Busy month.
              <br />
              <span className="text-lime">Same bill.</span>
            </h1>
            <p style={{ "--d": 2 } as React.CSSProperties} className="enter max-w-[48ch] text-lg text-field-muted">
              Flatdesk is an email and chat help desk for teams of 3 to 15. You pay per seat, {usd(PLAN.annualSeatPrice)} billed yearly or{" "}
              {usd(PLAN.seatPrice)} month to month, and {PLAN.includedPerAgent} AI answers a seat come with it. When the AI reaches the cap it pauses
              instead of billing you.
            </p>
            <div style={{ "--d": 3 } as React.CSSProperties} className="enter flex flex-wrap gap-3">
              <Link href="/sign-up" className="btn btn-on-field">
                Start your free trial
              </Link>
              <a href="#switch" className="btn btn-ghost-field">
                How switching works
              </a>
            </div>
            <p style={{ "--d": 3 } as React.CSSProperties} className="enter text-sm text-field-muted">
              Small team moving off Zendesk or Freshdesk?{" "}
              <a href="#partner" className="link font-medium text-field-ink">Apply as a design partner</a> for half off and an import we run for you.
            </p>
          </div>
          <div className="enter-fade">
            <SwitchBill />
          </div>
        </div>
      </section>

      <div className="border-b border-line bg-surface">
        <ul className="mx-auto grid max-w-6xl sm:grid-cols-2 lg:grid-cols-4">
          {TERMS.map((t, i) => (
            <li key={t.title} className={`grid content-start gap-0.5 px-4 py-5 sm:px-6 ${i ? "border-t border-line sm:border-t-0" : ""} ${i % 2 ? "sm:border-l" : ""} ${i === 2 ? "lg:border-l" : ""} ${i > 1 ? "sm:border-t lg:border-t-0" : ""}`}>
              <span className="font-semibold">{t.title}</span>
              <span className="text-sm text-muted">{t.body}</span>
            </li>
          ))}
        </ul>
      </div>

      <section id="flat-rate" className="mx-auto grid w-full max-w-6xl scroll-mt-20 gap-14 px-4 pt-24 sm:px-6 sm:pt-32">
        <ChapterHead id="flat-rate" tab="Flat rate" title="Other help desks bill you for being busy. Flatdesk bills per seat.">
          When AI is priced per answer, a launch or a holiday rush lands on the invoice. Here the bill is your seat count, and the cap is on unless an admin
          changes it.
        </ChapterHead>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
          <div data-play="">
            <YearChart />
          </div>
          <div data-play="" className="grid content-start gap-4">
            <dl className="border-t border-ink/70">
              <Rate label="Per agent, billed yearly"><span className="num">{usd(PLAN.annualSeatPrice)}</span> a month</Rate>
              <Rate label="Per agent, month to month"><span className="num">{usd(PLAN.seatPrice)}</span> a month</Rate>
              <Rate label="AI answers"><span className="num">{PLAN.includedPerAgent.toLocaleString()}</span> per seat, pooled</Rate>
              <Rate label="At the cap">AI pauses</Rate>
              <Rate label="Overage, only if turned on"><span className="num">{usd(PLAN.overageRate, true)}</span> each</Rate>
              <Rate label="Tiers and add-ons">None</Rate>
            </dl>
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <Link href="/pricing" className="link font-medium text-accent">See pricing</Link>
              <Link href="/calculator" className="link font-medium text-accent">Try it with your numbers</Link>
            </p>
          </div>
        </div>
        <article className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
          <div data-play="" className="grid content-start gap-4">
            <h3 className="ink font-display text-3xl">See every AI answer you&apos;re charged for. Refund the wrong ones.</h3>
            <p className="max-w-[60ch] text-muted">
              Each month gets an itemized statement: which tickets the AI answered, the saved answers it used, and whether each one counted. If the AI got one
              wrong, an admin refunds it in one click. It stops counting and the ticket goes back to your team.
            </p>
            <ul className="grid gap-2 text-sm">
              {["No tiers and no add-ons: every seat gets every feature", "Refunds free up allowance and come off any overage", "Download the month as CSV"].map((p) => (
                <li key={p} className="flex gap-2.5">{mark}{p}</li>
              ))}
            </ul>
          </div>
          <div data-play="">
            <ReceiptShot />
          </div>
        </article>
        <div id="why-less" className="scroll-mt-24 rounded-[8px] bg-surface-2 px-5 py-10 sm:px-10 sm:py-12">
          <WhyFlat leftOut={false} />
        </div>
      </section>

      <section id="ai-macros" className="mt-24 scroll-mt-20 border-y border-line bg-surface py-24 sm:mt-32 sm:py-32">
        <div className="mx-auto grid w-full max-w-6xl gap-14 px-4 sm:px-6">
          <ChapterHead id="ai-macros" tab="AI macros" title="Your team's best replies become macros, and keep up as things change.">
            Flatdesk finds the answers your team keeps typing and the AI turns each one into a macro. When prices or policies change, the macros learn it from
            how your team edits them. Macros are in the seat and never use your AI allowance.
          </ChapterHead>
          <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-16">
            <div data-play="" className="relative">
              <MacroShot />
            </div>
            <ol data-play="" className="grid gap-7">
              {MACRO_STEPS.map((step, i) => (
                <li key={step.title} style={{ "--i": i } as React.CSSProperties} className="ln grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 border-t border-line pt-4">
                  <span className="num text-sm font-semibold text-accent">{String(i + 1).padStart(2, "0")}</span>
                  <span className="grid gap-1">
                    <span className="text-lg font-semibold">{step.title}</span>
                    <span className="text-muted">{step.body}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <article className="grid items-center gap-10 border-t border-line pt-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
            <div data-play="" className="grid content-start gap-4">
              <h3 className="ink font-display text-3xl">When most sends make the same edit, the macro learns it.</h3>
              <p className="text-muted">
                A new shipping time, a changed refund policy, a step that no longer applies: your team fixes it by hand in the reply first. Flatdesk sees when
                most sends make the same edit, and the AI rewrites the macro with it. An admin applies it in one click, so the macros grow with the business.
              </p>
              <ul className="grid gap-2 text-sm">
                {["Counts only sends of the current version, so one fix starts the count again", "Keeps your placeholders, greeting and sign-off", "Included in the seat, where Zendesk sells macro suggestions in its $50 Copilot add-on"].map((p) => (
                  <li key={p} className="flex gap-2.5">{mark}{p}</li>
                ))}
              </ul>
              <Link href="/features/ai-macros" className="link w-max text-sm font-medium text-accent">How AI macros work</Link>
            </div>
            <div data-play="">
              <MacroUpdateShot />
            </div>
          </article>
          <div data-play="" className="grid gap-6 border-t border-line pt-14">
            <h3 className="ink font-display text-3xl">One click on a macro can also assign, tag and close the ticket.</h3>
            <ul className="grid sm:grid-cols-2 lg:grid-cols-5">
              {MACRO_ACTIONS.map((a, i) => (
                <li
                  key={a.title}
                  style={{ "--i": i } as React.CSSProperties}
                  className="ln grid content-start gap-1 border-t-2 border-ink py-4 sm:mr-5"
                >
                  <span className="font-semibold">{a.title}</span>
                  <span className="text-sm text-muted">{a.body}</span>
                </li>
              ))}
            </ul>
          </div>
          <div data-play="" className="grid gap-6 border-t border-line pt-14">
            <h3 className="ink font-display text-3xl">Elsewhere, AI help with macros is an add-on. Here it&apos;s in the seat.</h3>
            <AddOnTable />
          </div>
        </div>
      </section>

      <section id="everything-else" className="mx-auto grid w-full max-w-6xl scroll-mt-20 gap-14 px-4 pt-24 sm:px-6 sm:pt-32">
        <ChapterHead id="everything-else" tab="Everything else" title="The rest of the help desk, in the same seat.">
          No tiers and no feature gates. Every seat gets all of it.
        </ChapterHead>
        {TOUR.map((f, i) => (
          <article
            key={f.id}
            id={f.id}
            className={`grid scroll-mt-24 items-center gap-8 lg:gap-16 ${i === 0 ? "lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]" : "lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]"}`}
          >
            <div data-play="" className={`grid content-start gap-3 ${i === 1 ? "lg:order-2" : ""}`}>
              <h3 className="ink font-display text-3xl">{f.title}</h3>
              <p className="max-w-[60ch] text-muted">{f.body}</p>
              <ul className="grid gap-1.5 text-sm">
                {f.points.map((p) => (
                  <li key={p} className="flex gap-2.5">{mark}{p}</li>
                ))}
              </ul>
              {f.href && <Link href={f.href} className="link w-max text-sm font-medium text-accent">{f.more}</Link>}
            </div>
            <div data-play="">{f.shot}</div>
          </article>
        ))}
        <div data-play="" className="grid gap-4">
          <h3 className="text-lg font-semibold">Also in every seat</h3>
          <ul className="grid border-t border-line sm:grid-cols-2 lg:grid-cols-4">
            {MORE.map((m, i) => (
              <li key={m.title} style={{ "--i": i } as React.CSSProperties} className="border-b border-line">
                <Link href={m.href} className="group flex h-full flex-col gap-0.5 py-4 text-sm sm:pr-6">
                  <span className="font-medium group-hover:text-accent">{m.title}</span>
                  <span className="text-muted">{m.body}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/features#all" className="link w-max text-sm font-medium text-accent">See every feature</Link>
        </div>
      </section>

      {/* Who it's for, and who it isn't. Saying so plainly is part of the case. */}
      <section id="fit" className="mx-auto grid w-full max-w-6xl scroll-mt-20 gap-10 px-4 pt-24 sm:px-6 sm:pt-32">
        <h2 data-play="" className="ink max-w-3xl font-display text-[2.6rem] sm:text-6xl">Made for small support teams, and plain about what it leaves out.</h2>
        <div className="grid gap-10 md:grid-cols-2 md:gap-0">
          <div data-play="" className="grid content-start gap-4 border-t-2 border-accent pt-5 md:pr-10">
            <p className="text-lg font-semibold">A good fit if you</p>
            <ul className="grid gap-3">
              {[
                "Answer customers by email and website chat, with 3 to 15 people",
                "Want AI answers without a per-answer meter running",
                "Keep typing the same replies and want them written up for you",
                `Are on ${SOURCES.join(", ")} and want your history to come with you`,
              ].map((p) => (
                <li key={p} className="flex gap-2.5">{mark}{p}</li>
              ))}
            </ul>
          </div>
          <div data-play="" className="grid content-start gap-4 border-t-2 border-line-strong pt-5 md:border-l md:border-l-line md:pl-10">
            <p className="text-lg font-semibold">Look elsewhere if you need</p>
            <ul className="grid gap-3 text-muted">
              {LEFT_OUT.map((item) => (
                <li key={item} className="flex gap-2.5">
                  <span className="mt-[0.7em] h-[2px] w-3 shrink-0 bg-line-strong" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
            <Link href="/compare" className="link w-max text-sm font-medium text-accent">Where other help desks are ahead</Link>
          </div>
        </div>
      </section>

      <section id="switch" className="mx-auto grid w-full max-w-6xl scroll-mt-20 gap-12 px-4 pt-24 sm:px-6 sm:pt-32">
        <div data-play="" className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
          <h2 className="ink font-display text-[2.6rem] sm:text-6xl">How a switch goes.</h2>
          <p className="max-w-[52ch] self-end text-lg text-muted">Four steps, done by one admin. Nothing reaches a customer until you turn it on.</p>
        </div>
        <ol data-play="" className="relative grid gap-8 md:grid-cols-4 md:gap-6">
          <span aria-hidden="true" className="absolute top-[11px] right-[calc(25%-0.75rem)] left-3 hidden h-[2px] bg-ink md:block" />
          {SWITCH_STEPS.map((step, i) => (
            <li key={step.title} style={{ "--i": i } as React.CSSProperties} className="ln relative grid content-start gap-2 pl-9 md:pl-0">
              <span aria-hidden="true" className="absolute top-0 left-0 grid size-6 place-items-center rounded-full border-2 border-ink bg-bg md:relative md:mb-3">
                <span className="size-2 rounded-full bg-accent" />
              </span>
              <span className="num text-xs font-semibold text-muted">Step {i + 1}</span>
              <span className="text-lg font-semibold">{step.title}</span>
              <span className="text-sm text-muted">{step.body}</span>
            </li>
          ))}
        </ol>
        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-16">
          <div data-play="">
            <ImportShot />
          </div>
          <div data-play="" className="grid content-start gap-3">
            <h3 className="ink font-display text-2xl">Nothing is lost on the way over.</h3>
            <p className="text-muted">
              Every original record is archived with its ticket, anything that didn&apos;t map is listed in a report, and you can download the raw archive.
              Imports can be run again without making duplicates.
            </p>
            <Link href="/features/lossless-import" className="link w-max text-sm font-medium text-accent">How the import works</Link>
          </div>
        </div>
      </section>

      {/* The close, back on the green field: what trying it costs, and the design partner offer. */}
      <section id="partner" className="mt-24 -mb-24 scroll-mt-20 bg-field text-field-ink sm:mt-32">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
          <div data-play="" className="grid content-start gap-6">
            <h2 className="ink font-display text-4xl sm:text-6xl">Try it on your own tickets first.</h2>
            <p className="max-w-[46ch] text-lg text-field-muted">
              Import your history, let the AI draft answers to 50 real tickets beside your team&apos;s replies, and decide from that. No card for {TRIAL_DAYS} days.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/sign-up" className="btn btn-on-field">Start your free trial</Link>
              <Link href="/calculator" className="btn btn-ghost-field">Compare your bill in detail</Link>
            </div>
          </div>
          <div data-play="" className="grid content-start gap-5 rounded-[8px] bg-surface p-6 text-ink sm:p-8">
            <div className="grid gap-2">
              <h3 className="font-display text-2xl">Or become a design partner</h3>
              <p className="text-muted">
                A small group of teams gets <span className="hl hl-draw text-ink">50% off monthly billing for their first 12 months</span> ({usd(PLAN.seatPrice / 2)} per
                agent), and we run the import from their old help desk for them. The discount replaces the yearly price rather than adding to it.
              </p>
            </div>
            <WaitlistForm stacked />
          </div>
        </div>
      </section>
    </div>
  );
}
