import { ADDONS_CHECKED_ON, FEATURES, FLATDESK_ROW, GRID, GRID_SOURCES } from "@/lib/ai-addons";

const cross = (
  <span className="inline-flex items-center gap-1.5 text-muted">
    <svg viewBox="0 0 20 20" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8" /></svg>
    <span className="sr-only">Not offered</span>
  </span>
);

const check = (
  <svg viewBox="0 0 20 20" className="size-4 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 10.5l3 3 7-7" /></svg>
);

// AI macro features across help desks: an x where it isn't offered, the price where it's extra.
export default function AddOnTable() {
  const rows = [FLATDESK_ROW, ...GRID];
  return (
    <div className="grid gap-3">
      <div className="card overflow-x-auto" tabIndex={0} role="region" aria-label="AI macro features and prices by help desk">
        <table className="w-full min-w-[46rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left align-bottom">
              <th scope="col" className="px-4 py-3 font-medium text-muted sm:px-5"><span className="sr-only">Help desk</span></th>
              {FEATURES.map((f) => (
                <th key={f} scope="col" className="px-4 py-3 font-medium text-muted last:pr-5">{f}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.vendor} className={`border-b border-line last:border-0 ${i === 0 ? "bg-accent-soft font-medium" : ""}`}>
                <th scope="row" className="px-4 py-3.5 text-left font-medium whitespace-nowrap sm:px-5">{r.vendor}</th>
                {r.cells.map((c, j) => (
                  <td key={FEATURES[j]} className="px-4 py-3.5 last:pr-5">
                    {c === null ? cross : i === 0 ? <span className="inline-flex items-center gap-1.5">{check}{c}</span> : <span className="num">{c}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid gap-1 text-xs text-muted">
        {rows.filter((r) => r.note).map((r) => (
          <li key={r.vendor}><span className="text-ink">{r.vendor}:</span> {r.note}</li>
        ))}
      </ul>
      <p className="text-xs text-muted">
        Read from each vendor&apos;s pricing page and help docs on {ADDONS_CHECKED_ON}:{" "}
        {GRID_SOURCES.map((s, i) => (
          <span key={s.url}>
            {i > 0 ? ", " : ""}
            <a href={s.url} className="link" rel="noopener noreferrer" target="_blank">{s.label}</a>
          </span>
        ))}
        .
      </p>
    </div>
  );
}
