import type { Metadata } from "next";
import Link from "next/link";
import AddOnTable from "@/components/AddOnTable";
import JsonLd from "@/components/JsonLd";
import SwitchBill from "@/components/SwitchBill";
import WaitlistForm from "@/components/WaitlistForm";
import HeroDemo from "@/components/HeroDemo";
import ProductTour from "@/components/ProductTour";
import LoopVideo from "@/components/LoopVideo";
import { TRIAL_DAYS } from "@/lib/billing";
import { organization, pageMeta, software, website } from "@/lib/seo";
import { PLAN, PRICE_PHRASE, usd } from "@/lib/pricing";
import { LEFT_OUT } from "@/lib/why-flat";

// One story, told top to bottom: the month gets busier and the bill doesn't.
// The hero shows it happening in the real inbox, the flat-rate chapter shows
// it over a year and against the visitor's own bill, the tour shows what the
// seat includes screen by screen, and the rest answers who it's for, how to
// move and what trying it costs.

const SOURCES = ["Zendesk", "Intercom", "Freshdesk", "Help Scout"];

// Under the hero: what switching costs you, before anyone asks.
const TERMS = [
  { title: `${TRIAL_DAYS} days free`, body: `No card. Every feature, and ${PLAN.trialPerAgent} AI answers per agent.` },
  { title: "Month to month", body: "No contract on monthly plans. Cancel any time." },
  { title: "Bring your history", body: `Tickets, customers and macros from ${SOURCES.slice(0, 3).join(", ")} or Help Scout.` },
  { title: "Export your data", body: "Everything in one .zip, attachments and help articles included." },
];

// Smaller things in the seat, one line each, after the tour.
const MORE = [
  { title: "Live chat widget", body: "One script tag. Chats become tickets.", href: "/features#all" },
  { title: "Help center", body: "Articles customers search and the AI links to.", href: "/features#all" },
  { title: "AI test drive", body: "AI drafts for the last 50 tickets your team answered, beside its replies.", href: "/features/ai-test-drive" },
  { title: "Slack alerts and ratings", body: "A ping when a ticket needs a person, reply time targets, and ratings.", href: "/features#all" },
  { title: "Search, priority, bulk", body: "Find any ticket by its words, customer, tag or #number. Urgent sits on top. Change many at once.", href: "/features#all" },
  { title: "Auto-translate", body: "Customer messages in Spanish, Japanese and 20 more show in your language. Your reply goes back in theirs.", href: "/features#all" },
  { title: "Who's on this ticket", body: "See when a teammate is already replying, so a customer never gets two answers.", href: "/features#all" },
  { title: "Merge, CC, mentions", body: "Fold a duplicate into another ticket, keep everyone copied, and @name a teammate in a note.", href: "/features#all" },
  { title: "What customers ask about", body: "The AI groups recent tickets into topics, shows where it handed off and why, and suggests one fix for each.", href: "/features#all" },
  { title: "Groups and routing", body: "Billing, Tier 2, your call. Tickets go round in turn, skipping anyone away. Ones the AI answers never land in a queue.", href: "/features#all" },
  { title: "Triggers and auto-close", body: "Run on a new ticket, a customer reply, or hours with no update. One click closes quiet pending tickets.", href: "/features#all" },
  { title: "Reply and resolve targets", body: "Next reply within 15 minutes to 24 hours, resolved within 4 hours to 7 days. The clock can pause while you wait on the customer. Late tickets are escalated.", href: "/features#all" },
];

// The route from an old help desk to Flatdesk, in the order an admin does it.
const SWITCH_STEPS = [
  { title: "Import your history", body: `Paste an API key from ${SOURCES.join(", ").replace(/, ([^,]*)$/, " or $1")}. Tickets come over with full threads, plus customers, macros and tags. From Zendesk, help center articles come too. Triggers and automations that tag, assign, set status or email the customer keep working. Other rules are copied for reference. You can turn the AI off before importing, so nothing goes to it until you say.` },
  { title: "Connect email and chat", body: "Forward your support email and add one line of code to your site for chat. You can stop forwarding any time." },
  { title: "Test drive the AI", body: "The AI drafts replies to the last 50 tickets your team answered, next to what your team sent. Customers see none of it." },
  { title: "Turn it on", body: "Turn on AI answers, invite your team, and cancel your old help desk when you're ready." },
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
    <header data-play="" suppressHydrationWarning className="grid gap-5">
      <a href={`#${id}`} className="w-max rounded-t-[5px] border-x border-t border-ink/80 px-3 pt-1.5 pb-1 text-sm font-semibold">{tab}</a>
      <div className="grid gap-5 border-t-2 border-ink pt-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
        <h2 className="ink font-display text-4xl sm:text-[3.4rem]">{title}</h2>
        {children && <p className="max-w-[56ch] self-end text-lg text-muted">{children}</p>}
      </div>
    </header>
  );
}

export const metadata: Metadata = pageMeta({
  title: "Flatdesk: flat-price help desk with AI answers included",
  description: `Flatdesk is a help desk for teams of 3 to 15 agents: ${PRICE_PHRASE}, with ${PLAN.includedPerAgent} AI answers per agent included and capped. A Zendesk alternative that imports your tickets, customers and macros.`,
  path: "/",
});

export default function Home() {
  return (
    <div className="grid">
      <JsonLd data={[organization(), website(), software()]} />

      {/* The first screen: the headline on the bank-note green field, and the real
          inbox under it, filling up while the bill beside it stays put. The
          field ends partway down the screenshot so it sits across the edge. */}
      <section className="hero-split text-field-ink">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 pt-14 sm:px-6 sm:pt-20 lg:gap-16">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end lg:gap-14">
            <h1 style={{ "--d": 1 } as React.CSSProperties} className="enter font-display text-[3.4rem] leading-[0.95] sm:text-[5.2rem]">
              Busy months
              <br />
              <span className="text-lime">don&apos;t cost extra.</span>
            </h1>
            <div className="grid content-end gap-6">
              <p style={{ "--d": 2 } as React.CSSProperties} className="enter max-w-[48ch] text-lg text-field-muted">
                Flatdesk is an email and chat help desk for teams of 3 to 15. It&apos;s {usd(PLAN.annualSeatPrice)} per agent a month billed yearly, or{" "}
                {usd(PLAN.seatPrice)} month to month. Each agent gets {PLAN.includedPerAgent} AI answers a month. When the team runs out, the AI stops. It
                doesn&apos;t bill you more.
              </p>
              <div style={{ "--d": 3 } as React.CSSProperties} className="enter flex flex-wrap items-center gap-x-5 gap-y-3">
                <Link href="/sign-up" className="btn btn-on-field">
                  Start your free trial
                </Link>
                <a href="#switch" className="btn btn-ghost-field">
                  How switching works
                </a>
                <span className="text-sm text-field-muted">Free for {TRIAL_DAYS} days. No card needed.</span>
              </div>
            </div>
          </div>
          <div className="enter-fade">
            <HeroDemo />
          </div>
        </div>
      </section>

      <div className="mt-6 border-b border-line sm:mt-20">
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
        <ChapterHead id="flat-rate" tab="Flat rate" title="Many help desks charge for AI answers one by one. Flatdesk charges per agent.">
          An AI answer is a reply the AI sends a customer by itself, by email or in your chat, with nobody on your team involved. When you pay per answer, a
          launch or a holiday rush shows up on your invoice. Here the bill depends only on how many agents you have, and the AI
          stops at its limit unless an admin says otherwise.
        </ChapterHead>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
          <figure className="grid content-start gap-3">
            <div className="app-frame app-frame-light">
              <LoopVideo
                name="busy-month"
                width={1280}
                height={720}
                label="A month with a launch week, day by day. Tickets and AI answers climb. Paying per AI answer, the bill grows to about $511; on Flatdesk it stays at $156 for 4 seats."
              />
            </div>
            <figcaption className="text-xs text-muted">
              An example month for 4 agents with a launch week. Fin Essential at list price, {usd(29)} a seat plus {usd(0.99, true)} per AI answer,
              against Flatdesk&apos;s {usd(PLAN.annualSeatPrice)} a seat; both billed yearly.{" "}
              <Link href="/calculator" className="link text-accent">Try your own numbers</Link>
            </figcaption>
          </figure>
          <div data-play="" suppressHydrationWarning className="grid content-start gap-4">
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
              <Link href="/pricing#why-less" className="link font-medium text-accent">How this much fits in one seat</Link>
            </p>
          </div>
        </div>
        {/* The same story with the visitor's own numbers. */}
        <article className="grid items-center gap-10 rounded-[10px] bg-field px-5 py-10 text-field-ink sm:px-10 sm:py-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
          <div data-play="" suppressHydrationWarning className="grid content-start gap-4">
            <h3 className="ink font-display text-3xl sm:text-4xl">Put in your own team and see both bills.</h3>
            <p className="max-w-[48ch] text-field-muted">
              Pick the help desk you use now, your number of agents and how many AI answers you&apos;d expect a month. It uses each vendor&apos;s list
              prices, and it says so when the other tool comes out cheaper.
            </p>
            <Link href="/calculator" className="link w-max text-sm font-medium text-lime">Open the full calculator</Link>
          </div>
          <SwitchBill />
        </article>
      </section>

      <section id="everything-else" className="mt-24 scroll-mt-20 border-y border-line bg-surface py-24 sm:mt-32 sm:py-32">
        <div className="mx-auto grid w-full max-w-6xl gap-14 px-4 sm:px-6">
          <ChapterHead id="everything-else" tab="In every seat" title="AI answers, AI macros and the whole help desk, in one seat.">
            There&apos;s one plan, and every agent gets every feature. Short animations show what each part does, with sample data.
          </ChapterHead>
          <ProductTour />
          <div data-play="" suppressHydrationWarning className="grid gap-4 pt-6">
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
          <div data-play="" suppressHydrationWarning className="grid gap-6 border-t border-line pt-14">
            <h3 className="ink font-display text-3xl">Elsewhere, AI help with macros costs extra or needs a higher plan. Flatdesk includes it.</h3>
            <AddOnTable />
          </div>
          {/* The first ask after the product, so nobody has to scroll to the close to act on it. */}
          <div data-play="" suppressHydrationWarning className="flex flex-wrap items-center justify-between gap-4 rounded-[8px] bg-surface-2 px-5 py-6 sm:px-8">
            <p className="max-w-[52ch] text-lg">
              <span className="font-semibold">Watch it turn your team&apos;s replies into macros.</span>{" "}
              <span className="text-muted">Import your old tickets during the trial and see suggestions the same day.</span>
            </p>
            <Link href="/sign-up" className="btn btn-primary">Start your free trial</Link>
          </div>
        </div>
      </section>

      {/* Who it's for, and who it isn't. Saying so plainly is part of the case. */}
      <section id="fit" className="mx-auto grid w-full max-w-6xl scroll-mt-20 gap-10 px-4 pt-24 sm:px-6 sm:pt-32">
        <h2 data-play="" suppressHydrationWarning className="ink max-w-3xl font-display text-[2.6rem] sm:text-6xl">Built for small support teams. Here&apos;s what it doesn&apos;t do.</h2>
        <div className="grid gap-10 md:grid-cols-2 md:gap-0">
          <div data-play="" suppressHydrationWarning className="grid content-start gap-4 border-t-2 border-accent pt-5 md:pr-10">
            <p className="text-lg font-semibold">A good fit if you</p>
            <ul className="grid gap-3">
              {[
                "Have 3 to 15 people answering email and website chat",
                "Want AI answers without paying for each one",
                "Keep typing the same replies and want macros made for you",
                `Use ${SOURCES.join(", ").replace(/, ([^,]*)$/, " or $1")} and want to bring your old tickets`,
              ].map((p) => (
                <li key={p} className="flex gap-2.5">{mark}{p}</li>
              ))}
            </ul>
          </div>
          <div data-play="" suppressHydrationWarning className="grid content-start gap-4 border-t-2 border-line-strong pt-5 md:border-l md:border-l-line md:pl-10">
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
        <div data-play="" suppressHydrationWarning className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
          <h2 className="ink font-display text-[2.6rem] sm:text-6xl">How to switch from Zendesk or Intercom.</h2>
          <p className="max-w-[52ch] self-end text-lg text-muted">One admin can do all four steps. The AI can&apos;t reply to a customer until you forward your email or add the chat widget, and you can switch it off before that.</p>
        </div>
        <ol data-play="" suppressHydrationWarning className="relative grid gap-8 md:grid-cols-4 md:gap-6">
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
          <figure className="app-frame">
            <LoopVideo
              name="switch"
              width={1280}
              height={720}
              label="An import from Zendesk: tickets and threads, customers, macros, help articles and rules fill in on the Flatdesk side. Original records are kept, and the import report lists 3 items to check."
            />
          </figure>
          <div data-play="" suppressHydrationWarning className="grid content-start gap-3">
            <h3 className="ink font-display text-2xl">Nothing gets dropped in the import.</h3>
            <p className="text-muted">
              Each ticket keeps its original record, and a report lists anything Flatdesk couldn&apos;t match. You can download the raw data. Running the import
              again won&apos;t create duplicates.
            </p>
            <Link href="/features/lossless-import" className="link w-max text-sm font-medium text-accent">How the import works</Link>
          </div>
        </div>
      </section>

      {/* The close, back on the green field: what trying it costs, with the design partner offer folded beside it. */}
      <section id="partner" className="mt-24 -mb-24 scroll-mt-20 bg-field text-field-ink sm:mt-32">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
          <div data-play="" suppressHydrationWarning className="grid content-start gap-6">
            <h2 className="ink font-display text-4xl sm:text-6xl">Try it on your own tickets first.</h2>
            <p className="max-w-[46ch] text-lg text-field-muted">
              Import your old tickets and see AI drafts for the last 50 your team answered, next to your team&apos;s replies. Free for {TRIAL_DAYS} days, no card
              needed.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/sign-up" className="btn btn-on-field">Start your free trial</Link>
              <Link href="/calculator" className="btn btn-ghost-field">Compare your bill in detail</Link>
            </div>
          </div>
          {/* The trial is the one ask; the design-partner program stays one click away for the few teams it suits. */}
          <details data-play="" suppressHydrationWarning className="group self-start rounded-[8px] bg-surface p-6 text-ink sm:p-8">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
              <span className="grid gap-1">
                <span className="font-display text-2xl">Moving a small team off Zendesk or Freshdesk?</span>
                <span className="text-muted">Apply to be a design partner. You get half off, and we run the import for you.</span>
              </span>
              <span aria-hidden="true" className="text-2xl text-muted transition-transform group-open:rotate-45">+</span>
            </summary>
            <div className="mt-5 grid gap-5">
              <p className="text-muted">
                A few teams get <span className="hl text-ink">50% off monthly billing for 12 months</span> ({usd(PLAN.seatPrice / 2, true)} per agent), and we run
                the import for them. The discount replaces the yearly price. It doesn&apos;t stack with it.
              </p>
              <WaitlistForm stacked />
            </div>
          </details>
        </div>
      </section>
    </div>
  );
}
