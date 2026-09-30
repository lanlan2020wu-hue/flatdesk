import { ADDONS, ADDONS_CHECKED_ON, ADDON_TEAM, FLATDESK_ADDON } from "@/lib/ai-addons";
import { usd } from "@/lib/pricing";

// What AI help with replies and macros costs as an add-on elsewhere, Flatdesk first.
export default function AddOnTable() {
  const rows = [FLATDESK_ADDON, ...ADDONS];
  const sources = ADDONS.flatMap((a) => a.sources);
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted">
        AI help with macros and replies, as each help desk sells it. The extra cost is for a team of {ADDON_TEAM} agents, on top of that vendor&apos;s seat price.
      </p>
      <div className="card overflow-x-auto" tabIndex={0} role="region" aria-label="AI macro add-on prices">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className="px-4 py-3 font-medium text-muted sm:px-5">Help desk</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">Extra for {ADDON_TEAM} agents</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted">What you get</th>
              <th scope="col" className="px-4 py-3 font-medium text-muted sm:px-5">Price</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.vendor} className={`border-b border-line last:border-0 ${i === 0 ? "bg-accent-soft font-medium" : ""}`}>
                <th scope="row" className="px-4 py-3 text-left font-medium whitespace-nowrap sm:px-5">{r.vendor}</th>
                <td className="num px-4 py-3 text-right whitespace-nowrap">
                  {r.perAgent === null ? "Included" : `+${usd(r.perAgent * ADDON_TEAM)} a month`}
                </td>
                <td className="px-4 py-3">{r.feature}</td>
                <td className={`px-4 py-3 sm:px-5 ${i === 0 ? "" : "text-muted"}`}>{r.price}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        Read from each vendor&apos;s pricing page and help docs on {ADDONS_CHECKED_ON}:{" "}
        {sources.map((s, i) => (
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
