import type { BusinessHours } from "@/db/schema";
import { formatDue, shortDuration, type SlaState } from "@/lib/sla";

// Where a ticket stands against the first-reply target, as a small pill.
// The first-reply countdown, or with target="resolve" the resolution one (shown only when close or late).
export default function SlaBadge({ state, hours, className = "", target = "reply" }: { state: SlaState | null; hours: BusinessHours | null; className?: string; target?: "reply" | "resolve" }) {
  if (!state) return null;
  const at = formatDue(state.due, hours);
  if (target === "resolve") {
    if (state.kind === "overdue") return <span className={`pill whitespace-nowrap bg-warn text-[var(--surface)] ${className}`} title={`Resolution was due ${at}`}>Resolve overdue {shortDuration(state.minutesLate)}</span>;
    if (state.kind === "waiting" && state.soon) return <span className={`pill whitespace-nowrap bg-warn-soft text-warn ${className}`} title={`Resolution due ${at}`}>Resolve in {shortDuration(state.minutesLeft)}</span>;
    return null;
  }
  if (state.kind === "overdue") {
    return (
      <span className={`pill whitespace-nowrap bg-warn text-[var(--surface)] ${className}`} title={`First reply was due ${at}`}>
        Reply overdue {shortDuration(state.minutesLate)}
      </span>
    );
  }
  if (state.kind === "waiting") {
    return (
      <span className={`pill whitespace-nowrap ${state.soon ? "bg-warn-soft text-warn" : "bg-surface-2 text-muted"} ${className}`} title={`First reply due ${at}`}>
        Reply in {shortDuration(state.minutesLeft)}
      </span>
    );
  }
  return null;
}
