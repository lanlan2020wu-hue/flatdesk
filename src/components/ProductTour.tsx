"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import LoopVideo from "@/components/LoopVideo";
import { PLAN, usd } from "@/lib/pricing";

// The seat, one screen at a time. Most stops play a short story loop (rendered
// with Remotion); the bill stop is a real screenshot with a small card acting
// out what that screen does. The tabs advance on their own
// (the progress rule under the open tab runs out, then the next one opens),
// pause while the pointer or focus is inside, and stay put for visitors who
// ask for reduced motion.

const at = (ms: number) => ({ "--at": `${ms}ms` }) as React.CSSProperties;

type Stop = { id: string; tab: string; title: string; body: string; src: string; alt: string; href: string; more: string; cue: React.ReactNode; video?: { name: string; label: string } };

// How long a stop stays open: one play of its video, or long enough to read the card.
const VIDEO_MS = 11000;
const CARD_MS = 7500;

const STOPS: Stop[] = [
  {
    id: "answers",
    tab: "AI answers",
    title: "The AI replies to customers on its own, and stops at your limit.",
    body: `It answers email and chat from your macros, help articles and the facts you give it. When it isn't sure, it hands the ticket to your team. Each agent adds ${PLAN.includedPerAgent} AI answers a month to a shared pool.`,
    src: "/product/ai-answer.webp",
    alt: "A chat ticket in Flatdesk: the customer asks about a grind setting and the AI's reply, sent on its own, shows which saved answer it used and that it counted toward the allowance.",
    href: "/features/ai-test-drive",
    more: "Try it on 50 past tickets first",
    video: { name: "ai-answers", label: "Customers write in. The AI answers two of them on its own, each counted toward 400 included answers, and hands a third, an upset customer, to Ana without counting it." },
    cue: (
      <div className="grid gap-2 text-sm">
        <p className="cue rounded-[6px] bg-surface-2 px-3 py-2" style={at(150)}>
          What grind do you recommend for a V60?
        </p>
        <p className="cue rounded-[6px] border-l-2 border-accent bg-accent-soft px-3 py-2" style={at(900)}>
          Medium-fine, about like table salt. Start with 15 g to 250 g of water.
        </p>
        <p className="cue num flex justify-between gap-3 text-xs text-muted" style={at(1700)}>
          <span>Counted, included</span>
          <span>216 of 400</span>
        </p>
      </div>
    ),
  },
  {
    id: "actions",
    tab: "AI actions",
    title: "The AI can refund, cancel and reset, within your limits.",
    body: "It can refund a Stripe payment, cancel a subscription or an unshipped Shopify order, or call your own system for things like password resets. For each action you choose: it runs on its own, runs up to an amount, or waits for a person. Only for customers who emailed in, and every refund is checked against their own payments first.",
    src: "/product/inbox.webp",
    alt: "",
    href: "/features#all",
    more: "See every feature",
    cue: null,
    video: { name: "ai-actions", label: "Under a $50 refund limit, the AI checks a $29 double charge against the customer's own Stripe payments, refunds it and replies. A $79 refund is over the limit, so it waits on the ticket until a person clicks Approve and send." },
  },
  {
    id: "macros",
    tab: "AI macros",
    title: "The replies your team keeps retyping become macros.",
    body: "When roughly the same answer has gone out on 5 tickets, the AI writes it up as a macro for you to check and save. When a price or policy changes, it suggests an update from your team's edits. Macros never use AI answers.",
    src: "/product/macros.webp",
    alt: "Flatdesk's AI macros page: a list of saved replies, one marked Written by Flatdesk AI, with the tags and status each one sets.",
    href: "/features/ai-macros",
    more: "How AI macros work",
    video: { name: "ai-macros", label: "Five agents send nearly the same refund reply. Flatdesk folds them into one macro it wrote, Refund timing, and an admin saves it. Macros never use AI answers." },
    cue: (
      <div className="grid gap-2 text-sm">
        <p className="cue flex items-center justify-between gap-3 text-xs" style={at(150)}>
          <span className="font-medium text-accent">Found in your replies</span>
          <span className="num text-muted">sent on 12 tickets</span>
        </p>
        <p className="cue font-semibold" style={at(500)}>Refund timing</p>
        <p className="cue-write text-muted" style={at(900)}>
          Hi [first name], refunds go back to the original card within 5 business days.
        </p>
        <p className="cue flex gap-2 pt-1" style={at(2600)}>
          <span className="press rounded-[5px] bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink" style={at(3000)}>Save macro</span>
          <span className="rounded-[5px] border border-line px-2.5 py-1 text-xs">Edit</span>
        </p>
      </div>
    ),
  },
  {
    id: "receipts",
    tab: "AI receipts",
    title: "Every AI answer is itemized, and you can refund the bad ones.",
    body: "Each month lists every ticket the AI answered, what it used and whether it counted. If one was wrong, an admin refunds it with one click. It stops counting and the ticket goes back to your team.",
    src: "/product/receipts.webp",
    alt: "Flatdesk's AI answers statement for October: answers included, answers counted, refunds left and AI charges of $0.00, beside the list of answered tickets.",
    href: "/features/ai-receipts",
    more: "How AI receipts work",
    video: { name: "ai-receipts", label: "October's AI answers print out as a receipt. One wrong answer is refunded: it's struck off, stops counting and goes back to the team. AI charges stay at $0.00." },
    cue: (
      <div className="grid gap-1.5 text-sm">
        <p className="cue num flex justify-between gap-3" style={at(150)}>
          <span>#1207 Refund timing</span>
          <span className="text-muted">counted</span>
        </p>
        <p className="cue num relative flex justify-between gap-3" style={at(450)}>
          <span className="strike">#1196 Wrong roast date</span>
          <span className="stamp-in rounded-[4px] border border-warn px-1.5 text-xs text-warn" style={at(1600)}>Refunded</span>
        </p>
        <p className="cue num flex justify-between gap-3" style={at(750)}>
          <span>#1188 Pause a subscription</span>
          <span className="text-muted">counted</span>
        </p>
        <p className="cue num mt-1 flex justify-between gap-3 border-t border-dashed border-line-strong pt-2 font-medium" style={at(2200)}>
          <span>AI charges this month</span>
          <span>$0.00</span>
        </p>
      </div>
    ),
  },
  {
    id: "integrations",
    tab: "Integrations",
    title: "Orders, billing and contacts, right on the ticket.",
    body: "Connect Shopify, Stripe and HubSpot and each ticket shows that customer's recent orders with tracking, their plan and payments, and their contact card. Send a bug to Jira with one button and see its status. There's an API for everything else.",
    src: "/product/inbox.webp",
    alt: "",
    href: "/integrations",
    more: "See integrations",
    cue: null,
    video: { name: "integrations", label: "A customer asks where their order is. Shopify, Stripe and HubSpot cards appear beside the ticket, the agent replies with the UPS tracking number, and sends the broken tracking link to Jira as SHIP-212." },
  },
  {
    id: "bill",
    tab: "Your bill",
    title: "One bill per agent, the same every month.",
    body: `${usd(PLAN.seatPrice)} per agent month to month, or ${usd(PLAN.annualSeatPrice)} billed yearly. When the team's AI answers run out, the AI pauses. Nothing is added to the invoice unless an admin turns on overage.`,
    src: "/product/overview.webp",
    alt: "Flatdesk's overview page: this month's bill of $196 for 4 seats at $49, with 215 of 400 AI answers used and a note that nothing extra is charged at the cap.",
    href: "/pricing",
    more: "See pricing",
    cue: (
      <dl className="grid gap-1.5 text-sm">
        <div className="cue num flex justify-between gap-3" style={at(150)}>
          <dt>September</dt>
          <dd>{usd(4 * PLAN.seatPrice)}</dd>
        </div>
        <div className="cue num flex justify-between gap-3" style={at(500)}>
          <dt>October, launch month</dt>
          <dd>{usd(4 * PLAN.seatPrice)}</dd>
        </div>
        <div className="cue num flex justify-between gap-3" style={at(850)}>
          <dt>November, holiday rush</dt>
          <dd>{usd(4 * PLAN.seatPrice)}</dd>
        </div>
        <div className="cue mt-1 border-t border-line pt-2 text-xs text-muted" style={at(1500)}>
          An example team of 4. Tickets went up every month.
        </div>
      </dl>
    ),
  },
];

export default function ProductTour() {
  const [open, setOpen] = useState(0);
  const stop = STOPS[open];

  return (
    <div data-play="" suppressHydrationWarning className="tour grid gap-8">
      <div role="tablist" aria-label="Flatdesk, screen by screen" className="grid grid-cols-2 border-t border-line sm:grid-cols-3 lg:grid-cols-6">
        {STOPS.map((s, i) => {
          const on = i === open;
          return (
            <button
              key={s.id}
              role="tab"
              id={`tour-tab-${s.id}`}
              aria-selected={on}
              aria-controls={`tour-panel-${s.id}`}
              tabIndex={on ? 0 : -1}
              onClick={() => setOpen(i)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                const next = (i + (e.key === "ArrowRight" ? 1 : STOPS.length - 1)) % STOPS.length;
                setOpen(next);
                document.getElementById(`tour-tab-${STOPS[next].id}`)?.focus();
              }}
              className={`relative py-4 pr-4 text-left font-semibold transition-colors ${on ? "text-ink" : "text-muted hover:text-ink"}`}
            >
              <span aria-hidden="true" className={`absolute inset-x-0 -top-px h-[2px] ${on ? "bg-line-strong" : ""}`} />
              {on && <span aria-hidden="true" key={open} style={{ "--tour-ms": `${s.video ? VIDEO_MS : CARD_MS}ms` } as React.CSSProperties} className="tour-progress absolute inset-x-0 -top-px h-[2px] bg-ink" onAnimationEnd={() => setOpen((open + 1) % STOPS.length)} />}
              {s.tab}
            </button>
          );
        })}
      </div>

      <div
        key={stop.id}
        role="tabpanel"
        id={`tour-panel-${stop.id}`}
        aria-labelledby={`tour-tab-${stop.id}`}
        className="grid items-start gap-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-12"
      >
        <div className="grid content-start gap-4">
          <h3 className="ink font-display text-3xl">{stop.title}</h3>
          <p className="text-muted">{stop.body}</p>
          <Link href={stop.href} className="link w-max text-sm font-medium text-accent">{stop.more}</Link>
        </div>
        {stop.video ? (
          <figure className="app-frame">
            <LoopVideo name={stop.video.name} label={stop.video.label} width={1280} height={720} />
          </figure>
        ) : (
          <div className="relative">
            <figure className="app-frame app-frame-light">
              <Image src={stop.src} alt={stop.alt} width={2560} height={1480} sizes="(min-width: 1024px) 720px, 100vw" className="block h-auto w-full" />
            </figure>
            <div aria-hidden="true" className="tour-cue relative z-10 mr-3 -mt-10 ml-auto w-[17rem] rounded-[8px] border border-line bg-surface p-4 text-ink shadow-lg sm:absolute sm:right-[-1rem] sm:bottom-[-1.5rem] sm:mt-0 sm:mr-0 sm:w-[19rem]">
              {stop.cue}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
