"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  COMPETITORS,
  PLAN,
  competitorById,
  competitorMonthly,
  flatdeskMonthly,
  usd,
} from "@/lib/pricing";

type Props = {
  initialTool: string;
  initialAgents: number;
  initialResolutions: number;
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

export default function Calculator({ initialTool, initialAgents, initialResolutions }: Props) {
  const [toolId, setToolId] = useState(competitorById(initialTool).id);
  const [agents, setAgents] = useState(initialAgents);
  const [resolutions, setResolutions] = useState(initialResolutions);
  const tool = competitorById(toolId);
  const [rate, setRate] = useState(tool.aiRate);
  const [copied, setCopied] = useState(false);

  const a = clamp(agents, 1, 500);
  const r = clamp(resolutions, 0, 1_000_000);
  const today = useMemo(() => competitorMonthly(tool, a, r, rate), [tool, a, r, rate]);
  const ours = useMemo(() => flatdeskMonthly(a, r), [a, r]);
  const yearlySavings = (today.total - ours.withOverage) * 12;

  useEffect(() => {
    const qs = new URLSearchParams({ tool: toolId, agents: String(a), resolutions: String(r) });
    window.history.replaceState(null, "", `?${qs}`);
  }, [toolId, a, r]);

  function pickTool(id: string) {
    setToolId(id);
    setRate(competitorById(id).aiRate);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const field = "field num";
  const barMax = Math.max(today.total, ours.withOverage, 1);
  const bar = (n: number) => `${Math.max(2, (n / barMax) * 100)}%`;

  return (
    <div style={{ "--d": 2 } as React.CSSProperties} className="enter grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <form className="card grid content-start gap-5 self-start p-5 sm:p-6 lg:sticky lg:top-24" onSubmit={(e) => e.preventDefault()}>
        <p className="eyebrow">Your numbers</p>
        <label className="grid gap-1.5" htmlFor="tool">
          <span className="label">What you use today</span>
          <select id="tool" className="field" value={toolId} onChange={(e) => pickTool(e.target.value)}>
            {COMPETITORS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.vendor} {c.plan}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5" htmlFor="agents">
          <span className="label">Agents</span>
          <input id="agents" type="number" min={1} max={500} className={field} value={agents}
            onChange={(e) => setAgents(e.target.valueAsNumber)} />
        </label>
        <label className="grid gap-1.5" htmlFor="resolutions">
          <span className="label">AI-resolved conversations per month</span>
          <input id="resolutions" type="number" min={0} step={50} className={field} value={resolutions}
            onChange={(e) => setResolutions(e.target.valueAsNumber)} />
          <span className="text-xs text-muted">Check your last invoice or usage page. If you don&apos;t know, 10–20% of monthly tickets is typical.</span>
        </label>
        <label className="grid gap-1.5" htmlFor="rate">
          <span className="label">Their price per AI resolution</span>
          <input id="rate" type="number" min={0} step={0.01} className={field} value={rate}
            onChange={(e) => setRate(clamp(e.target.valueAsNumber, 0, 100))} />
          <span className={`text-xs ${tool.estimated ? "text-warn" : "text-muted"}`}>{tool.aiNote}</span>
        </label>
      </form>

      <section aria-live="polite" className="grid content-start gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="card p-5 sm:p-6">
            <p className="text-sm text-muted">{tool.vendor} {tool.plan}, estimated</p>
            <p className="num mt-1 text-4xl tracking-tight">{usd(today.total)}<span className="text-base text-muted">/mo</span></p>
            <dl className="mt-4 grid gap-1.5 border-t border-line pt-3 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted">Seats, {a} × {usd(tool.seatPrice)} ({tool.billing})</dt><dd className="num">{usd(today.seats)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">AI, {Math.max(0, r - today.included).toLocaleString()} × {usd(rate, true)}</dt><dd className="num">{usd(today.ai)}</dd></div>
            </dl>
          </div>
          <div className="card border-accent/40 bg-accent-soft p-5 shadow-md sm:p-6">
            <p className="text-sm font-medium text-accent">Flatdesk</p>
            <p className="num mt-1 text-4xl tracking-tight">{usd(ours.capped)}<span className="text-base text-muted">/mo</span></p>
            <dl className="mt-4 grid gap-1.5 border-t border-accent/20 pt-3 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted">Seats, {a} × {usd(PLAN.seatPrice)}</dt><dd className="num">{usd(ours.seats)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">AI resolutions included</dt><dd className="num">{ours.included.toLocaleString()}</dd></div>
            </dl>
          </div>
        </div>

        <div className="card grid gap-3 p-5 sm:p-6" aria-hidden="true">
          <div className="grid gap-1.5">
            <div className="flex justify-between text-sm"><span className="text-muted">{tool.vendor}</span><span className="num">{usd(today.total)}</span></div>
            <div className="h-3 overflow-hidden rounded-full bg-surface-2"><div className="meter h-full rounded-full bg-chart-other transition-[width] duration-300" style={{ width: bar(today.total) }} /></div>
          </div>
          <div className="grid gap-1.5">
            <div className="flex justify-between text-sm"><span className="text-muted">Flatdesk</span><span className="num">{usd(ours.capped)}</span></div>
            <div className="h-3 overflow-hidden rounded-full bg-surface-2"><div className="meter h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: bar(ours.capped) }} /></div>
          </div>
        </div>

        {ours.extra > 0 && (
          <p className="flex gap-3 rounded-xl border border-warn/25 bg-warn-soft px-4 py-3 text-sm">
            <svg viewBox="0 0 20 20" className="mt-0.5 size-4 shrink-0 text-warn" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="10" cy="10" r="7.5" /><path d="M10 6.5v4M10 13.5h.01" /></svg>
            <span>
              You&apos;d go {ours.extra.toLocaleString()} resolutions past the included {ours.included.toLocaleString()}. By default the AI pauses and those
              tickets go to your team, so the bill stays {usd(ours.capped)}. If an admin turns on overage, they cost {usd(PLAN.overageRate, true)} each,
              for {usd(ours.withOverage)} in total.
            </span>
          </p>
        )}

        <p className="font-display text-2xl leading-snug">
          {yearlySavings > 0 ? (
            <>You&apos;d pay about <strong className="num hl font-medium">{usd(yearlySavings)}</strong> less per year{ours.extra > 0 ? ", even with overage on" : ""}.</>
          ) : (
            <>At this size {tool.vendor} costs about the same or less. Flatdesk still caps your AI bill by default.</>
          )}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Link href="/#waitlist" className="btn btn-primary">Join the waitlist</Link>
          <button type="button" onClick={copyLink} className="btn btn-secondary">
            {copied ? "Link copied" : "Copy link to these numbers"}
          </button>
        </div>

        <p className="text-xs text-muted">
          Estimates use list prices and your inputs. Taxes, add-ons such as Zendesk Copilot, and negotiated discounts are not included. Sources:{" "}
          {tool.sources.map((s, i) => (
            <span key={s.url}>{i > 0 && " · "}<a className="link" href={s.url} target="_blank" rel="noreferrer">{s.label}</a></span>
          ))}
        </p>
      </section>
    </div>
  );
}
