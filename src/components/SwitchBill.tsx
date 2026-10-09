"use client";

import Link from "next/link";
import { useState } from "react";
import { COMPETITORS, PLAN, competitorById, competitorMonthly, flatdeskMonthly, usd } from "@/lib/pricing";

// The homepage's first screen: the visitor's own bill today beside the same
// month on Flatdesk, from the same list prices as the calculator. When the
// other tool costs less at these numbers, it says so.

const VENDORS = [...new Set(COMPETITORS.map((c) => c.vendor))];
const short = (vendor: string) => vendor.replace(" (formerly Intercom)", "");
const MAX_AGENTS = 50;
const MAX_AI = 3000;

function Line({ label, value, className = "" }: { label: React.ReactNode; value: React.ReactNode; className?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${className}`}>
      <dt className="min-w-0">{label}</dt>
      <dd className="num shrink-0 text-right">{value}</dd>
    </div>
  );
}

export default function SwitchBill({ initialTool = "zendesk-team", initialAgents = 5, initialAi = 300 }) {
  const [toolId, setToolId] = useState(initialTool);
  const [agents, setAgents] = useState(initialAgents);
  const [ai, setAi] = useState(initialAi);
  const tool = competitorById(toolId);
  const plans = COMPETITORS.filter((c) => c.vendor === tool.vendor);
  const today = competitorMonthly(tool, agents, ai);
  const ours = flatdeskMonthly(agents, ai, "year");
  // Compared with overage on, so both columns pay for every AI answer.
  const diff = today.total - ours.withOverage;
  const billed = today.ai > 0 ? Math.max(0, ai - today.included) : 0;
  const qs = new URLSearchParams({ tool: toolId, agents: String(agents), resolutions: String(ai), billing: "yearly" });

  return (
    <figure data-play="" suppressHydrationWarning className="receipt-shadow relative w-full">
      <span aria-hidden="true" className="printer-slot" />
      <div className="print receipt grid gap-5 px-5 pt-8 pb-9 text-ink sm:px-7">
        <figcaption className="grid gap-1">
          <span className="font-display text-xl">Your bill, side by side</span>
          <span className="text-sm text-muted">Set it to your team. Same month, list prices.</span>
        </figcaption>

        <div className="grid gap-3 text-sm">
          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 font-medium">You use</legend>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
              {VENDORS.map((v) => {
                const on = tool.vendor === v;
                return (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setToolId(COMPETITORS.find((c) => c.vendor === v)!.id)}
                    className={`rounded-[5px] border px-2 py-1.5 font-medium transition-colors ${on ? "border-ink bg-ink text-bg" : "border-line-strong hover:border-ink"}`}
                  >
                    {short(v)}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1" role="group" aria-label="Plan">
              {plans.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={p.id === toolId}
                  onClick={() => setToolId(p.id)}
                  className={`text-sm underline-offset-4 transition-colors ${p.id === toolId ? "font-medium text-ink underline decoration-2 decoration-accent" : "text-muted hover:text-ink"}`}
                >
                  {p.plan}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 border-t border-line pt-3">
            <span id="sb-agents" className="font-medium">Agents</span>
            <div className="flex items-center justify-end gap-1" role="group" aria-labelledby="sb-agents">
              <button type="button" aria-label="One fewer agent" onClick={() => setAgents((a) => Math.max(1, a - 1))} className="grid size-8 place-items-center rounded-[5px] border border-line-strong hover:border-ink">
                <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M3.5 8h9" /></svg>
              </button>
              <output className="num w-10 text-center text-base font-medium" aria-live="polite">{agents}</output>
              <button type="button" aria-label="One more agent" onClick={() => setAgents((a) => Math.min(MAX_AGENTS, a + 1))} className="grid size-8 place-items-center rounded-[5px] border border-line-strong hover:border-ink">
                <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M3.5 8h9M8 3.5v9" /></svg>
              </button>
            </div>
            <label htmlFor="sb-ai" className="font-medium">AI answers a month</label>
            <div className="flex items-center gap-3">
              <input
                id="sb-ai"
                type="range"
                min={0}
                max={MAX_AI}
                step={50}
                value={ai}
                onChange={(e) => setAi(e.target.valueAsNumber)}
                className="h-1.5 min-w-0 flex-1 cursor-pointer accent-[var(--accent)]"
              />
              <output htmlFor="sb-ai" className="num w-12 text-right text-base font-medium">{ai.toLocaleString("en-US")}</output>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 sm:gap-0">
          <div className="grid content-start gap-1.5 border-t-2 border-ink pt-3 text-[13px] sm:pr-5">
            <p className="mb-1 font-medium">
              {short(tool.vendor)} {tool.plan}
            </p>
            <dl className="contents">
              <Line label={<span className="text-muted">{agents} × {usd(tool.seatPrice)} seats</span>} value={usd(today.seats)} />
              {billed > 0 && today.included > 0 && (
                <Line label={<span className="text-muted">{today.included.toLocaleString("en-US")} AI included</span>} value="$0" />
              )}
              <Line
                label={<span className="text-muted">{billed ? `${billed.toLocaleString("en-US")} AI × ${usd(tool.aiRate, true)}` : "AI answers"}</span>}
                value={usd(today.ai)}
              />
              <Line label="A month" value={usd(today.total)} className="mt-auto border-t border-line pt-2 text-base font-medium" />
            </dl>
          </div>
          <div className="relative grid content-start gap-1.5 border-t-2 border-accent pt-3 text-[13px] sm:border-l sm:border-l-line sm:pl-5">
            <p className="mb-1 font-medium text-accent">Flatdesk</p>
            <dl className="contents">
              <Line label={<span className="text-muted">{agents} × {usd(PLAN.annualSeatPrice)} seats</span>} value={usd(ours.seats)} />
              <Line
                label={<span className="text-muted">{ours.extra ? `${ours.included.toLocaleString("en-US")} AI included` : `AI, ${ai.toLocaleString("en-US")} of ${ours.included.toLocaleString("en-US")}`}</span>}
                value="$0"
              />
              {ours.extra > 0 && (
                <Line
                  label={<span className="text-muted">{ours.extra.toLocaleString("en-US")} more × {usd(PLAN.overageRate, true)}</span>}
                  value={usd(ours.withOverage - ours.seats)}
                />
              )}
              <Line label="A month" value={usd(ours.withOverage)} className="mt-auto border-t border-line pt-2 text-base font-medium" />
            </dl>
            <span
              aria-hidden="true"
              className="stamp absolute -top-4 right-0 rotate-6 rounded-[4px] border-2 border-accent bg-surface px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.2em] text-accent uppercase"
            >
              Flat
            </span>
          </div>
        </div>

        <div className="grid gap-1.5 rounded-[6px] bg-accent-soft px-4 py-3" aria-live="polite">
          {diff > 0 ? (
            <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="font-medium">You&apos;d pay less</span>
              <span className="num text-2xl font-semibold tracking-tight text-accent">{usd(diff * 12)} a year</span>
            </p>
          ) : (
            <p className="font-medium">
              At these numbers {short(tool.vendor)} costs {diff === 0 ? "the same" : `${usd(-diff)} a month less`}. Flatdesk pulls ahead as AI answers grow.
            </p>
          )}
          {ours.extra > 0 && (
            <p className="text-xs text-muted">
              This counts overage at {usd(PLAN.overageRate, true)} an answer past the {ours.included.toLocaleString("en-US")} included. Overage is off unless an admin turns it on. With the cap on, the AI pauses there, your team answers the rest, and the bill stays {usd(ours.capped)}.
            </p>
          )}
        </div>

        <p className="text-xs text-muted">
          Both billed yearly{tool.billing === "monthly" ? `, except ${short(tool.vendor)}, which lists this plan monthly` : ""}.{" "}
          {tool.estimated && `${short(tool.vendor)} doesn't publish its AI rate, so this uses third-party reports. `}
          <Link href={`/calculator?${qs}`} className="link text-ink">Full breakdown and sources</Link>
        </p>
      </div>
    </figure>
  );
}
