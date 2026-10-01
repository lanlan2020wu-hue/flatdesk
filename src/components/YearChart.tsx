import { PLAN, competitorById, competitorMonthly, flatdeskMonthly, usd } from "@/lib/pricing";

// An example year for a 10-agent team whose AI volume follows a seasonal
// pattern. Every bar is computed from the same list prices as the calculator.
const AGENTS = 10;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const RESOLUTIONS = [1100, 1200, 1350, 1500, 1450, 1300, 1250, 1400, 1700, 1900, 2100, 1600];

export default function YearChart() {
  const fin = competitorById("fin-advanced");
  const rows = MONTHS.map((m, i) => ({
    month: m,
    resolutions: RESOLUTIONS[i],
    fin: competitorMonthly(fin, AGENTS, RESOLUTIONS[i]).total,
    // With overage on, so both bars pay for every AI answer.
    ours: flatdeskMonthly(AGENTS, RESOLUTIONS[i], "year").withOverage,
  }));
  const max = Math.max(...rows.map((r) => r.fin));
  const top = Math.ceil(max / 500) * 500;
  const pct = (n: number) => `${(n / top) * 100}%`;
  const ticks = [0, top / 2, top];
  // The seat price is the floor; overage adds $0.40 per answer past the allowance.
  const plan = flatdeskMonthly(AGENTS, 0, "year");
  const flat = plan.capped;

  return (
    <figure className="card grid gap-5 p-5 sm:p-6">
      <figcaption className="grid gap-3">
        <div className="grid gap-1">
          <p className="font-medium">Monthly bill for a 10-agent team, one example year</p>
          <p className="text-sm text-muted">AI answers rise from 1,100 to 2,100 a month in the busy season.</p>
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-label="Legend">
          <li className="flex items-center gap-2"><span className="size-2.5 rounded-sm bg-chart-other" />{fin.vendor} {fin.plan}</li>
          <li className="flex items-center gap-2"><span className="size-2.5 rounded-sm bg-accent" />Flatdesk</li>
        </ul>
      </figcaption>

      <div className="relative grid grid-cols-[auto_1fr] gap-3" aria-hidden="true">
        <div className="num relative h-52 w-10 text-right text-[11px] text-muted">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0" style={{ bottom: pct(t), transform: "translateY(50%)" }}>
              {t >= 1000 ? `$${t / 1000}k` : `$${t}`}
            </span>
          ))}
        </div>
        <div className="relative h-52">
          {ticks.map((t) => (
            <div key={t} className={`absolute inset-x-0 border-t ${t === 0 ? "border-line-strong" : "border-dashed border-line"}`} style={{ bottom: pct(t) }} />
          ))}
          <div className="absolute inset-0 grid grid-cols-12 gap-1 sm:gap-2">
            {rows.map((r, i) => (
              <div key={r.month} style={{ "--i": i } as React.CSSProperties} className="group relative flex items-end justify-center gap-[2px]">
                <div className="bar w-full max-w-4 rounded-t-[4px] bg-chart-other transition-opacity group-hover:opacity-80" style={{ height: pct(r.fin) }} />
                <div className="bar bar-flat w-full max-w-4 rounded-t-[4px] bg-accent transition-opacity group-hover:opacity-80" style={{ height: pct(r.ours) }} />
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden w-max -translate-x-1/2 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-md group-hover:block">
                  <p className="mb-1 font-medium">{r.month}: {r.resolutions.toLocaleString()} AI answers</p>
                  <p className="num flex justify-between gap-4"><span className="text-muted">{fin.vendor}</span>{usd(r.fin)}</p>
                  <p className="num flex justify-between gap-4"><span className="text-muted">Flatdesk</span>{usd(r.ours)}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flatline pointer-events-none absolute inset-x-0 border-t-2 border-accent" style={{ bottom: pct(flat) }} />
          <span className="flatline-label num pointer-events-none absolute left-1 rounded border border-accent/30 shadow-sm bg-surface px-1.5 text-[11px] font-medium text-accent" style={{ bottom: `calc(${pct(flat)} + 4px)` }}>
            {usd(flat)} seats, plus overage
          </span>
        </div>
        <div />
        <div className="num grid grid-cols-12 gap-1 text-center text-[11px] text-muted sm:gap-2">
          {rows.map((r) => <span key={r.month}>{r.month.slice(0, 1)}<span className="hidden sm:inline">{r.month.slice(1)}</span></span>)}
        </div>
      </div>

      {/* Tables ignore sr-only's 1px width, so the wrapper carries it (otherwise phones scroll sideways). */}
      <div className="sr-only">
      <table>
        <caption>Monthly bill for a 10-agent team, one example year</caption>
        <thead><tr><th>Month</th><th>AI answers</th><th>{fin.vendor} {fin.plan}</th><th>Flatdesk</th></tr></thead>
        <tbody>
          {rows.map((r) => <tr key={r.month}><td>{r.month}</td><td>{r.resolutions}</td><td>{usd(r.fin)}</td><td>{usd(r.ours)}</td></tr>)}
        </tbody>
      </table>
      </div>

      <p className="text-xs text-muted">
        {fin.vendor} at list price with annual billing. Flatdesk with annual billing and overage turned on, so both pay for every AI answer: {plan.included.toLocaleString()}{" "}
        are included, and each one past that is {usd(PLAN.overageRate, true)}. With the default cap instead, the bill stays {usd(flat)} and your team answers the rest.
      </p>
    </figure>
  );
}
