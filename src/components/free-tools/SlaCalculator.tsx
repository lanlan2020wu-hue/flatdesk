"use client";

import { useMemo, useState } from "react";
import { hhmm, parseWallClock, slaAttainment, slaDue } from "@/lib/support-math";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const n = (v: number) => (Number.isFinite(v) ? v : 0);

// Wall-clock minutes are stored as UTC, so format them in UTC to read them back unchanged.
const when = (minutes: number) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(minutes * 60_000));

function duration(minutes: number) {
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = Math.round(minutes % 60);
  return [d && `${d} day${d === 1 ? "" : "s"}`, h && `${h} hour${h === 1 ? "" : "s"}`, m && `${m} min`].filter(Boolean).join(" ") || "0 min";
}

export default function SlaCalculator() {
  const [received, setReceived] = useState("2026-10-09T16:00");
  const [hours, setHours] = useState(4);
  const [minutes, setMinutes] = useState(0);
  const [open, setOpen] = useState("09:00");
  const [close, setClose] = useState("17:00");
  const [days, setDays] = useState([false, true, true, true, true, true, false]);
  const [allHours, setAllHours] = useState(false);

  const [total, setTotal] = useState(480);
  const [missed, setMissed] = useState(18);
  const [target, setTarget] = useState(95);

  const start = parseWallClock(received);
  const openM = hhmm(open);
  const closeM = hhmm(close);
  const targetMinutes = n(hours) * 60 + n(minutes);
  const due = useMemo(() => {
    if (start === null || openM === null || closeM === null) return null;
    return slaDue(start, targetMinutes, { open: openM, close: closeM, days, allHours });
  }, [start, openM, closeM, targetMinutes, days, allHours]);
  const attainment = slaAttainment(n(total), n(missed), n(target) / 100);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-16">
      <section aria-labelledby="due" className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <form className="card grid content-start gap-5 p-5 sm:p-6" onSubmit={(e) => e.preventDefault()}>
          <h2 id="due" className="font-display text-2xl">When is this ticket due?</h2>
          <label className="grid gap-1.5" htmlFor="received">
            <span className="label">Ticket received</span>
            <input id="received" type="datetime-local" className="field num" value={received} onChange={(e) => setReceived(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5" htmlFor="sla-hours">
              <span className="label">Target, hours</span>
              <input id="sla-hours" type="number" min={0} className="field num" value={Number.isFinite(hours) ? hours : ""} onChange={(e) => setHours(e.target.valueAsNumber)} />
            </label>
            <label className="grid gap-1.5" htmlFor="sla-minutes">
              <span className="label">and minutes</span>
              <input id="sla-minutes" type="number" min={0} max={59} step={5} className="field num" value={Number.isFinite(minutes) ? minutes : ""} onChange={(e) => setMinutes(e.target.valueAsNumber)} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allHours} onChange={(e) => setAllHours(e.target.checked)} />
            The clock runs 24/7
          </label>
          {!allHours && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1.5" htmlFor="open">
                  <span className="label">Opens</span>
                  <input id="open" type="time" className="field num" value={open} onChange={(e) => setOpen(e.target.value)} />
                </label>
                <label className="grid gap-1.5" htmlFor="close">
                  <span className="label">Closes</span>
                  <input id="close" type="time" className="field num" value={close} onChange={(e) => setClose(e.target.value)} />
                </label>
              </div>
              <fieldset className="grid gap-1.5">
                <legend className="label mb-1.5">Working days</legend>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS.map((d, i) => (
                    <label key={d} className={`cursor-pointer rounded-md border px-2.5 py-1 text-sm transition-colors has-focus-visible:outline-2 has-focus-visible:outline-accent ${days[i] ? "border-accent bg-accent-soft font-medium" : "border-line text-muted"}`}>
                      <input type="checkbox" className="sr-only" checked={days[i]} onChange={(e) => setDays(days.map((v, j) => (j === i ? e.target.checked : v)))} />
                      {d}
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          )}
        </form>
        <div className="grid content-start gap-4" aria-live="polite">
          <div className="card border-accent/40 bg-accent-soft p-5 sm:p-6">
            <p className="text-sm font-medium text-accent">Due by</p>
            <p className="mt-1 font-display text-3xl">{due !== null ? when(due) : start === null ? "Enter when the ticket arrived" : closeM !== null && openM !== null && closeM <= openM ? "Closing time must be after opening time" : "Pick at least one working day"}</p>
          </div>
          {due !== null && start !== null && (
            <p className="text-muted">
              A {duration(targetMinutes)} target{allHours ? "" : " in business hours"} on a ticket received {when(start)} ends {duration(due - start)} later on the clock.
            </p>
          )}
          <p className="text-sm text-muted">
            Times are in whatever time zone you enter them in. Holidays aren&rsquo;t counted; if one falls inside the window, add a day. Most help desks also pause the clock while a ticket waits on the customer.
          </p>
        </div>
      </section>

      <section aria-labelledby="attainment" className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <form className="card grid content-start gap-5 p-5 sm:p-6" onSubmit={(e) => e.preventDefault()}>
          <h2 id="attainment" className="font-display text-2xl">Are we hitting our SLA?</h2>
          <label className="grid gap-1.5" htmlFor="total">
            <span className="label">Tickets this period</span>
            <input id="total" type="number" min={1} className="field num" value={Number.isFinite(total) ? total : ""} onChange={(e) => setTotal(e.target.valueAsNumber)} />
          </label>
          <label className="grid gap-1.5" htmlFor="missed">
            <span className="label">Tickets that missed the target</span>
            <input id="missed" type="number" min={0} className="field num" value={Number.isFinite(missed) ? missed : ""} onChange={(e) => setMissed(e.target.valueAsNumber)} />
          </label>
          <label className="grid gap-1.5" htmlFor="goal">
            <span className="label">Goal, % met</span>
            <input id="goal" type="number" min={1} max={100} className="field num" value={Number.isFinite(target) ? target : ""} onChange={(e) => setTarget(e.target.valueAsNumber)} />
          </label>
        </form>
        <div className="grid content-start gap-4" aria-live="polite">
          {attainment ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className={`card p-5 ${attainment.rate >= n(target) / 100 ? "border-accent/40 bg-accent-soft" : "border-warn/30 bg-warn-soft"}`}>
                  <p className="text-sm text-muted">SLA attainment</p>
                  <p className="num mt-1 text-3xl tracking-tight">{(attainment.rate * 100).toFixed(1)}%</p>
                </div>
                <div className="card p-5">
                  <p className="text-sm text-muted">More misses before you drop below {n(target)}%</p>
                  <p className="num mt-1 text-3xl tracking-tight">{attainment.missesLeft}</p>
                </div>
              </div>
              <p className="text-muted">
                {n(total) - n(missed)} of {n(total)} tickets met the target.{" "}
                {attainment.rate >= n(target) / 100
                  ? `You can miss ${attainment.missesLeft} more this period and still be at or above ${n(target)}%.`
                  : `That's below your ${n(target)}% goal.`}
              </p>
            </>
          ) : (
            <p className="card p-5 text-muted">Missed tickets can&rsquo;t be more than the total.</p>
          )}
        </div>
      </section>
    </div>
  );
}
