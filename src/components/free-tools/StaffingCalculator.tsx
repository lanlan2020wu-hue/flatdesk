"use client";

import { useMemo, useState } from "react";
import { backlogStaffing, erlangC, staffing } from "@/lib/support-math";

type Mode = "live" | "email";

const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;
const secs = (s: number) => (s < 90 ? `${Math.round(s)} sec` : `${(s / 60).toFixed(1)} min`);
const n = (v: number) => (Number.isFinite(v) ? v : 0);

function Field({ id, label, hint, value, onChange, step = 1, min = 0, max }: {
  id: string; label: string; hint?: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number;
}) {
  return (
    <label className="grid gap-1.5" htmlFor={id}>
      <span className="label">{label}</span>
      <input id={id} type="number" inputMode="decimal" className="field num" value={Number.isFinite(value) ? value : ""} step={step} min={min} max={max}
        onChange={(e) => onChange(e.target.valueAsNumber)} />
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? "card border-accent/40 bg-accent-soft p-5" : "card p-5"}>
      <p className={`text-sm ${strong ? "font-medium text-accent" : "text-muted"}`}>{label}</p>
      <p className="num mt-1 text-3xl tracking-tight">{value}</p>
    </div>
  );
}

export default function StaffingCalculator() {
  const [mode, setMode] = useState<Mode>("live");
  const [perHour, setPerHour] = useState(60);
  const [handleMin, setHandleMin] = useState(6);
  const [targetSec, setTargetSec] = useState(60);
  const [level, setLevel] = useState(80);
  const [concurrency, setConcurrency] = useState(2);
  const [shrink, setShrink] = useState(30);
  const [perDay, setPerDay] = useState(250);
  const [minPerTicket, setMinPerTicket] = useState(5);
  const [shift, setShift] = useState(8);

  const live = useMemo(
    () => staffing({ contactsPerHour: n(perHour), handleSeconds: n(handleMin) * 60, targetSeconds: n(targetSec), targetLevel: n(level) / 100, shrinkage: n(shrink) / 100, concurrency: n(concurrency) || 1 }),
    [perHour, handleMin, targetSec, level, shrink, concurrency],
  );
  const email = useMemo(
    () => backlogStaffing({ ticketsPerDay: n(perDay), minutesPerTicket: n(minPerTicket), hoursPerShift: n(shift), shrinkage: n(shrink) / 100 }),
    [perDay, minPerTicket, shift, shrink],
  );

  // Service level a few agents either side of the answer, so the trade-off is visible.
  const around = useMemo(() => {
    if (!live) return [];
    const handle = (n(handleMin) * 60) / Math.max(1, n(concurrency) || 1);
    const rows = [];
    for (let a = Math.max(Math.floor(live.traffic) + 1, live.agents - 2); a <= live.agents + 2; a++) {
      const c = erlangC(a, live.traffic);
      rows.push({ agents: a, level: 1 - c * Math.exp((-(a - live.traffic) * n(targetSec)) / handle), wait: (c * handle) / (a - live.traffic), occupancy: live.traffic / a });
    }
    return rows;
  }, [live, handleMin, concurrency, targetSec]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <form className="card grid content-start gap-5 self-start p-5 sm:p-6 lg:sticky lg:top-24" onSubmit={(e) => e.preventDefault()}>
        <fieldset className="grid gap-1.5">
          <legend className="label mb-1.5">Channel</legend>
          <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface-2 p-1 text-sm">
            {([["live", "Chat or phone"], ["email", "Email"]] as const).map(([value, label]) => (
              <label key={value} className={`cursor-pointer rounded-lg px-3 py-1.5 text-center transition-colors has-focus-visible:outline-2 has-focus-visible:outline-accent ${mode === value ? "bg-surface font-medium shadow-sm" : "text-muted hover:text-ink"}`}>
                <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="sr-only" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        {mode === "live" ? (
          <>
            <Field id="per-hour" label="Conversations per hour (busiest hour)" value={perHour} onChange={setPerHour} step={5} hint="Plan for your peak hour, not the daily average." />
            <Field id="handle" label="Average handle time, minutes" value={handleMin} onChange={setHandleMin} step={0.5} hint="Talk or chat time plus wrap-up." />
            <div className="grid grid-cols-2 gap-3">
              <Field id="level" label="Answer % of them" value={level} onChange={setLevel} min={1} max={99} />
              <Field id="target" label="within seconds" value={targetSec} onChange={setTargetSec} step={5} />
            </div>
            <Field id="concurrency" label="Chats per agent at once" value={concurrency} onChange={setConcurrency} min={1} max={6} hint="Use 1 for phone." />
          </>
        ) : (
          <>
            <Field id="per-day" label="Tickets per day" value={perDay} onChange={setPerDay} step={10} />
            <Field id="per-ticket" label="Minutes of work per ticket" value={minPerTicket} onChange={setMinPerTicket} step={0.5} hint="Include every reply on the ticket, not just the first." />
            <Field id="shift" label="Hours in a shift" value={shift} onChange={setShift} step={0.5} />
          </>
        )}
        <Field id="shrinkage" label="Shrinkage, %" value={shrink} onChange={setShrink} max={90} hint="Breaks, meetings, training, holidays and sick days. Enter your own figure if you track it." />
      </form>

      <section className="grid content-start gap-5" aria-live="polite">
        {mode === "live" ? (
          live ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Stat label="Agents to schedule" value={String(live.scheduled)} strong />
                <Stat label="Agents answering at once" value={String(live.agents)} />
                <Stat label={`Answered within ${n(targetSec)} sec`} value={pct(live.serviceLevel, 1)} />
                <Stat label="Average wait" value={secs(live.averageWaitSeconds)} />
              </div>
              <p className="text-muted">
                {n(perHour)} conversations an hour at {n(handleMin)} minutes each is {live.traffic.toFixed(1)} agents&rsquo; worth of work (in erlangs). With {live.agents} answering, {pct(live.serviceLevel)} are picked up within {n(targetSec)} seconds and agents are busy {pct(live.occupancy)} of the time. Adding {n(shrink)}% shrinkage gives <strong className="text-ink">{live.scheduled} agents on the schedule</strong> for that hour.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
                  <caption className="mb-2 text-left text-muted">What one agent more or less changes</caption>
                  <thead>
                    <tr className="border-b border-line text-muted">
                      <th scope="col" className="py-2 pr-4 font-medium">Answering</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Within {n(targetSec)} sec</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Average wait</th>
                      <th scope="col" className="py-2 font-medium">Occupancy</th>
                    </tr>
                  </thead>
                  <tbody className="num">
                    {around.map((r) => (
                      <tr key={r.agents} className={`border-b border-line ${r.agents === live.agents ? "bg-accent-soft font-medium" : ""}`}>
                        <th scope="row" className="py-2 pr-4 pl-1 font-sans font-medium">{r.agents}</th>
                        <td className="py-2 pr-4">{pct(r.level, 1)}</td>
                        <td className="py-2 pr-4">{secs(r.wait)}</td>
                        <td className="py-2">{pct(r.occupancy)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="card p-5 text-muted">Enter conversations per hour and a handle time above zero.</p>
          )
        ) : email ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Stat label="Agents to schedule" value={String(email.agents)} strong />
              <Stat label="Hours of ticket work a day" value={email.workHours.toFixed(1)} />
            </div>
            <p className="text-muted">
              {n(perDay)} tickets at {n(minPerTicket)} minutes each is {email.workHours.toFixed(1)} hours of work a day. Each agent spends about {email.perAgentHours.toFixed(1)} of their {n(shift)} hours on tickets once shrinkage is taken out, so you need {email.exact.toFixed(2)} agents, rounded up to <strong className="text-ink">{email.agents}</strong>. This keeps up with the day&rsquo;s volume; it doesn&rsquo;t promise any response time. For a response time target, add agents for your busiest hours or use the chat setting with your peak hour.
            </p>
          </>
        ) : (
          <p className="card p-5 text-muted">Enter tickets per day, minutes per ticket and shift hours above zero.</p>
        )}
      </section>
    </div>
  );
}
