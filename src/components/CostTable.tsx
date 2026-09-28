import { TEAMS, type Rival, costRows } from "@/lib/compare";
import { usd } from "@/lib/pricing";

// What two example teams would pay each month, Flatdesk first.
export default function CostTable({ rows, caption }: { rows: ReturnType<typeof costRows>; caption: string }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[40rem] text-sm">
        <caption className="px-4 pt-4 text-left text-muted sm:px-5">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-left">
            <th scope="col" className="eyebrow px-4 py-3 sm:px-5">Plan</th>
            {TEAMS.map((t) => (
              <th key={t.label} scope="col" className="eyebrow px-4 py-3 text-right">{t.label}</th>
            ))}
            <th scope="col" className="eyebrow px-4 py-3 sm:px-5">How AI is billed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.label} className={`border-b border-line last:border-0 ${i === 0 ? "bg-accent-soft font-medium" : ""}`}>
              <th scope="row" className="px-4 py-3 text-left font-medium sm:px-5">{r.label}</th>
              {r.costs.map((c, j) => (
                <td key={j} className="num px-4 py-3 text-right whitespace-nowrap">{r.approx ? "~" : ""}{usd(c)}</td>
              ))}
              <td className="px-4 py-3 text-muted sm:px-5">{r.aiBilling}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type { Rival };
