"use client";

import { useState, useTransition } from "react";
import { copilotSummaryAction } from "@/app/app/actions";
import type { TicketSummary } from "@/lib/copilot";

const MOOD: Record<TicketSummary["mood"], { label: string; tone: string }> = {
  calm: { label: "Calm", tone: "bg-accent-soft text-accent" },
  confused: { label: "Confused", tone: "bg-surface-2 text-ink" },
  frustrated: { label: "Frustrated", tone: "bg-warn/15 text-warn" },
  angry: { label: "Angry", tone: "bg-warn/20 text-warn" },
};

export const CopilotMark = ({ className = "size-4" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z" />
  </svg>
);

// The copilot's briefing on a ticket. A summary is kept until someone writes
// again, so opening a ticket twice doesn't spend anything.
export default function CopilotSummary({ ticketId, initial, stale, disabled }: { ticketId: string; initial: TicketSummary | null; stale: boolean; disabled?: boolean }) {
  const [summary, setSummary] = useState(initial);
  const [isStale, setStale] = useState(stale);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      setError(null);
      const r = await copilotSummaryAction(ticketId);
      if (r.ok) {
        setSummary(r.value);
        setStale(false);
      } else setError(r.error);
    });

  return (
    <section aria-labelledby="copilot-summary" className="grid gap-3 rounded-2xl border border-accent/25 bg-accent-soft/60 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="copilot-summary" className="flex items-center gap-2 font-medium text-accent">
          <CopilotMark />
          Copilot summary
        </h2>
        {!disabled && (!summary || isStale) && (
          <button type="button" onClick={run} disabled={pending} className="btn btn-secondary btn-sm">
            {pending ? "Reading…" : summary ? "Update" : "Summarize"}
          </button>
        )}
      </div>
      {summary ? (
        <div aria-busy={pending} className={`grid gap-2 ${pending ? "opacity-60" : ""}`}>
          <ul className="grid gap-1.5">
            {summary.points.map((p) => (
              <li key={p} className="flex gap-2">
                <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-accent" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
          <p className="flex flex-wrap items-center gap-2 border-t border-accent/15 pt-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${MOOD[summary.mood]?.tone ?? ""}`}>{MOOD[summary.mood]?.label ?? summary.mood}</span>
            <span className="text-muted">Next: <span className="text-ink">{summary.next}</span></span>
          </p>
          {isStale && <p className="text-xs text-muted">There are new messages since this summary.</p>}
        </div>
      ) : (
        <p className="text-muted">The copilot reads the whole conversation and tells you what the customer wants, where it stands and what to do next.</p>
      )}
      {error && <p role="alert" className="text-warn">{error}</p>}
    </section>
  );
}
