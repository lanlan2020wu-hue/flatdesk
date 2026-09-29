import type { BusinessHours } from "@/db/schema";
import { formatDue, shortDuration, type SlaState } from "@/lib/sla";

// Where a ticket stands against the first-reply target, as a small pill.
export default function SlaBadge({ state, hours, className = "" }: { state: SlaState | null; hours: BusinessHours | null; className?: string }) {
  if (!state) return null;
  const at = formatDue(state.due, hours);
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
