"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { PLAN, usd } from "@/lib/pricing";

// The first screen's picture: Flatdesk's real inbox, with new conversations
// arriving one after another. The month's ticket count keeps climbing and the
// AI answers some of them, but the bill card beside it never changes. That is
// the whole pitch, so it loops for as long as it's on screen.
//
// The screenshot is the real app with sample data (a 4-agent coffee roaster).

const AGENTS = 4;
const INCLUDED = AGENTS * PLAN.includedPerAgent;

type Arrival = { who: string; channel: "Email" | "Chat"; subject: string; outcome: string; ai: boolean };

const ARRIVALS: Arrival[] = [
  { who: "Tom Becker", channel: "Chat", subject: "Grind setting for a V60?", outcome: "AI answered", ai: true },
  { who: "Kai Nakamura", channel: "Email", subject: "Beans arrived crushed", outcome: "Assigned to Ana", ai: false },
  { who: "Hannah Lee", channel: "Email", subject: "Pause my subscription in November", outcome: "AI answered", ai: true },
  { who: "Sofía Ortega", channel: "Email", subject: "Wholesale price list?", outcome: "Assigned to Lee", ai: false },
  { who: "Ben Arkwright", channel: "Email", subject: "When will my refund arrive?", outcome: "AI answered", ai: true },
  { who: "Rosa Martín", channel: "Chat", subject: "Can my next bag be decaf?", outcome: "Assigned to Sam", ai: false },
];

const STEP_MS = 2800;

export default function HeroDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer: number | undefined;
    let visible = false;
    const tick = () => setStep((s) => s + 1);
    const sync = () => {
      window.clearInterval(timer);
      timer = visible && !document.hidden ? window.setInterval(tick, STEP_MS) : undefined;
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      sync();
    });
    if (ref.current) io.observe(ref.current);
    document.addEventListener("visibilitychange", sync);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      window.clearInterval(timer);
    };
  }, []);

  const current = ARRIVALS[step % ARRIVALS.length];
  const tickets = 1184 + step;
  let aiSoFar = 0;
  for (let i = 0; i <= step; i++) if (ARRIVALS[i % ARRIVALS.length].ai) aiSoFar++;
  const answered = Math.min(INCLUDED, 215 + aiSoFar);

  return (
    <div ref={ref} className="relative">
      <figure className="app-frame">
        <div className="app-frame-bar" aria-hidden="true">
          <span className="num truncate text-[11px] text-field-muted">flatdesk.app/app/inbox</span>
        </div>
        <Image
          src="/product/inbox.webp"
          alt="The Flatdesk inbox: six open conversations from email and chat, each with its customer, tags, assignee and first-reply target."
          width={2560}
          height={1480}
          priority
          sizes="(min-width: 1152px) 1104px, 100vw"
          className="block h-auto w-full"
        />
        <figcaption className="sr-only">Flatdesk&apos;s inbox, with sample data.</figcaption>
      </figure>

      {/* A new conversation drops in at the top right, every few seconds. */}
      <div aria-hidden="true" className="pointer-events-none absolute top-[9%] right-[2.5%] hidden w-[19rem] sm:block lg:right-[-1.5rem]">
        <div key={step} className="arrival grid gap-1.5 rounded-[8px] border border-line bg-surface p-3.5 text-ink shadow-lg">
          <span className="flex items-center justify-between gap-3 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span className="live-dot" />
              New {current.channel.toLowerCase()}
            </span>
            <span className="num">#{1212 + step}</span>
          </span>
          <span className="text-sm">
            <span className="font-semibold">{current.who}</span>
            <span className="text-muted"> · {current.subject}</span>
          </span>
          <span className={`arrival-outcome w-max rounded-[4px] px-1.5 py-0.5 text-xs font-medium ${current.ai ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted"}`}>
            {current.outcome}
          </span>
        </div>
      </div>

      {/* The month so far: tickets and AI answers climb, the bill stays put. */}
      <div className="relative mt-4 sm:absolute sm:bottom-[-2.5rem] sm:left-[-1.5rem] sm:mt-0 sm:w-[21rem]">
        <div className="grid gap-2 rounded-[8px] border border-line bg-surface p-4 text-sm text-ink shadow-lg">
          <dl className="contents">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">Tickets this month</dt>
              <dd key={tickets} className="num tick font-medium">{tickets.toLocaleString("en-US")}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">AI answers</dt>
              <dd className="num">
                <span key={answered} className="tick inline-block">{answered}</span> of {INCLUDED}
              </dd>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-line pt-3">
              <dt className="font-semibold">Your bill</dt>
              <dd className="num font-display text-2xl">{usd(AGENTS * PLAN.seatPrice)}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted">
            {AGENTS} agents × {usd(PLAN.seatPrice)}. Same amount however busy the month gets.
          </p>
        </div>
      </div>
    </div>
  );
}
