"use client";

import { useState } from "react";
import { ticketSnoozeAction } from "@/app/app/actions";

// Snooze choices in the agent's own time zone, worked out in the browser.
function choices(now: Date) {
  const at = (days: number, hour: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const toMonday = ((8 - now.getDay()) % 7) || 7;
  const list = [
    { label: "In 3 hours", at: new Date(now.getTime() + 3 * 3_600_000) },
    { label: "Tomorrow, 9 AM", at: at(1, 9) },
    { label: "Monday, 9 AM", at: at(toMonday, 9) },
    { label: "In a week", at: at(7, 9) },
  ];
  // On a Sunday, Monday 9 AM is tomorrow 9 AM: show it once.
  return list.filter((c, i) => list.findIndex((o) => o.at.getTime() === c.at.getTime()) === i);
}

const local = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

export default function SnoozeMenu({ ticketId, number }: { ticketId: string; number: number }) {
  const [now, setNow] = useState<Date | null>(null);
  const [custom, setCustom] = useState("");
  return (
    // The choices are worked out when the menu opens, so "in 3 hours" is from then.
    <details className="group grid gap-2" onToggle={(e) => e.currentTarget.open && setNow(new Date())}>
      <summary className="btn btn-secondary btn-sm w-fit cursor-pointer list-none">Snooze…</summary>
      <form action={ticketSnoozeAction} className="mt-2 grid gap-2">
        <input type="hidden" name="ticketId" value={ticketId} />
        <input type="hidden" name="number" value={number} />
        <div className="flex flex-wrap gap-1.5">
          {now &&
            choices(now).map((c) => (
              <button key={c.label} name="until" value={c.at.toISOString()} className="btn btn-secondary btn-sm" title={c.at.toLocaleString()}>
                {c.label}
              </button>
            ))}
        </div>
        <div className="flex gap-1.5">
          <input type="datetime-local" aria-label="Snooze until" min={now ? local(now) : undefined} value={custom} onChange={(e) => setCustom(e.target.value)} className="field field-sm min-w-0 flex-1" />
          <button name="until" value={custom ? new Date(custom).toISOString() : ""} disabled={!custom} className="btn btn-secondary btn-sm">
            Snooze
          </button>
        </div>
        <p className="text-xs text-muted">It leaves your views and comes back to Open then, or sooner if the customer writes.</p>
      </form>
    </details>
  );
}
