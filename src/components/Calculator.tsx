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

  const field = "w-full rounded-md border border-line bg-surface px-3 py-2 num text-ink";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <form className="grid content-start gap-5 rounded-xl border border-line bg-surface p-5" onSubmit={(e) => e.preventDefault()}>
        <label className="grid gap-1.5" htmlFor="tool">
          <span className="text-sm font-medium">What you use today</span>
          <select id="tool" className={field.replace("num", "font-sans")} value={toolId} onChange={(e) => pickTool(e.target.value)}>
            {COMPETITORS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.vendor} {c.plan}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5" htmlFor="agents">
          <span className="text-sm font-medium">Agents</span>
          <input id="agents" type="number" min={1} max={500} className={field} value={agents}
            onChange={(e) => setAgents(e.target.valueAsNumber)} />
        </label>
        <label className="grid gap-1.5" htmlFor="resolutions">
          <span className="text-sm font-medium">AI-resolved conversations per month</span>
          <input id="resolutions" type="number" min={0} step={50} className={field} value={resolutions}
            onChange={(e) => setResolutions(e.target.valueAsNumber)} />
          <span className="text-xs text-muted">Check your last invoice or usage page. If you don&apos;t know, 10–20% of monthly tickets is typical.</span>
        </label>
        <label className="grid gap-1.5" htmlFor="rate">
          <span className="text-sm font-medium">Their price per AI resolution</span>
          <input id="rate" type="number" min={0} step={0.01} className={field} value={rate}
            onChange={(e) => setRate(clamp(e.target.valueAsNumber, 0, 100))} />
          <span className={`text-xs ${tool.estimated ? "text-warn" : "text-muted"}`}>{tool.aiNote}</span>
        </label>
      </form>

      <section aria-live="polite" className="grid content-start gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface p-5">
            <p className="text-sm text-muted">{tool.vendor} {tool.plan}, estimated</p>
            <p className="num mt-1 text-3xl">{usd(today.total)}<span className="text-base text-muted">/mo</span></p>
            <dl className="mt-3 grid gap-1 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted">Seats, {a} × {usd(tool.seatPrice)} ({tool.billing})</dt><dd className="num">{usd(today.seats)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">AI, {Math.max(0, r - today.included).toLocaleString()} × {usd(rate, true)}</dt><dd className="num">{usd(today.ai)}</dd></div>
            </dl>
          </div>
          <div className="rounded-xl border border-accent bg-accent-soft p-5">
            <p className="text-sm text-muted">Flatdesk</p>
            <p className="num mt-1 text-3xl">{usd(ours.capped)}<span className="text-base text-muted">/mo</span></p>
            <dl className="mt-3 grid gap-1 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted">Seats, {a} × {usd(PLAN.seatPrice)}</dt><dd className="num">{usd(ours.seats)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">AI resolutions included</dt><dd className="num">{ours.included.toLocaleString()}</dd></div>
            </dl>
          </div>
        </div>

        {ours.extra > 0 && (
          <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm">
            You&apos;d go {ours.extra.toLocaleString()} resolutions past the included {ours.included.toLocaleString()}. By default the AI pauses and those
            tickets go to your team, so the bill stays {usd(ours.capped)}. If an admin turns on overage, they cost {usd(PLAN.overageRate, true)} each,
            for {usd(ours.withOverage)} in total.
          </p>
        )}

        <p className="text-lg">
          {yearlySavings > 0 ? (
            <>You&apos;d pay about <strong className="num">{usd(yearlySavings)}</strong> less per year{ours.extra > 0 ? ", even with overage on" : ""}.</>
          ) : (
            <>At this size {tool.vendor} costs about the same or less. Flatdesk still caps your AI bill by default.</>
          )}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={copyLink} className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm hover:border-accent">
            {copied ? "Link copied" : "Copy link to these numbers"}
          </button>
          <Link href="/#waitlist" className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink">Join the waitlist</Link>
        </div>

        <p className="text-xs text-muted">
          Estimates use list prices and your inputs. Taxes, add-ons such as Zendesk Copilot, and negotiated discounts are not included. Sources:{" "}
          {tool.sources.map((s, i) => (
            <span key={s.url}>{i > 0 && " · "}<a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.label}</a></span>
          ))}
        </p>
      </section>
    </div>
  );
}
