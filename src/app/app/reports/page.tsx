import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { targetLabel } from "@/lib/sla";
import { duration, REPORT_RANGES, type ReportRange, teamReport } from "@/lib/reports";

export const metadata = { title: "Reports" };

// One figure in a ruled grid, like the overview: no boxes around numbers.
function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="grid content-start gap-1 border-t border-line pt-3">
      <span className="text-sm text-muted">{label}</span>
      <span className="num text-3xl font-medium tracking-tight">{value}</span>
      {note && <span className="text-sm text-muted">{note}</span>}
    </div>
  );
}

export default async function ReportsPage({ searchParams }: PageProps<"/app/reports">) {
  const s = await requireSession();
  const { days: raw } = await searchParams;
  const days = (REPORT_RANGES.find((d) => String(d) === raw) ?? 30) as ReportRange;
  const r = await teamReport(s.orgId, days);
  const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);

  return (
    <div className="grid max-w-4xl gap-10 px-4 py-6 md:px-8 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Reports</h1>
        <nav className="flex gap-1 text-sm" aria-label="Date range">
          {REPORT_RANGES.map((d) => (
            <Link
              key={d}
              href={`/app/reports?days=${d}`}
              aria-current={d === days ? "page" : undefined}
              className={`rounded-md border px-3 py-1.5 ${d === days ? "border-accent bg-accent-soft" : "border-line bg-surface hover:bg-bg"}`}
            >
              Last {d} days
            </Link>
          ))}
        </nav>
      </div>

      <section className="grid gap-x-6 gap-y-6 sm:grid-cols-2 lg:grid-cols-3" aria-label="Summary">
        <Tile label="New tickets" value={String(r.created)} note={`${r.email} email, ${r.chat} chat`} />
        <Tile label="Median first response" value={duration(r.medianFirstResponse)} note="From arrival to first reply" />
        <Tile label="Median time to close" value={duration(r.medianResolution)} note={`${r.closed} closed, ${r.stillOpen} still open`} />
        <Tile
          label="Answered by AI"
          value={r.aiShare === null ? "–" : `${Math.round(r.aiShare * 100)}%`}
          note={`${r.aiResolved} answered, ${r.aiHandedOff} handed to the team`}
        />
        <Tile
          label="First replies on target"
          value={r.target ? pct(r.target.share) : "–"}
          note={
            r.target
              ? `${r.target.met} within ${targetLabel(r.target.minutes)}, ${r.target.missed} late. Imported tickets aren't counted.`
              : "No first-reply target set. Add one in Settings."
          }
        />
        <Tile
          label="Rated Great"
          value={pct(r.csat.score)}
          note={
            r.csat.total
              ? `${r.csat.total} ${r.csat.total === 1 ? "rating" : "ratings"}, ${r.csat.bad} Not good.${r.csat.team !== null ? ` Team ${pct(r.csat.team)}.` : ""}${r.csat.ai !== null ? ` AI ${pct(r.csat.ai)}.` : ""}`
              : "No ratings yet. Customers rate replies with one click from the email."
          }
        />
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">By agent</h2>
        {r.agents.length === 0 ? (
          <p className="text-muted">No agents yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-2 font-normal">Agent</th>
                  <th scope="col" className="px-4 py-2 text-right font-normal">Replies sent</th>
                  <th scope="col" className="px-4 py-2 text-right font-normal">Tickets closed</th>
                  <th scope="col" className="px-4 py-2 text-right font-normal">Open now</th>
                  <th scope="col" className="px-4 py-2 text-right font-normal">Rated Great</th>
                </tr>
              </thead>
              <tbody>
                {r.agents.map((a) => (
                  <tr key={a.userId} className="border-b border-line last:border-0">
                    <th scope="row" className="px-4 py-2 text-left font-normal">{a.name}</th>
                    <td className="num px-4 py-2 text-right">{a.replies}</td>
                    <td className="num px-4 py-2 text-right">{a.closed}</td>
                    <td className="num px-4 py-2 text-right">{a.openNow}</td>
                    <td className="num px-4 py-2 text-right" title={`${a.rated} ${a.rated === 1 ? "rating" : "ratings"}`}>{pct(a.csat)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-sm text-muted">Tickets closed counts closed tickets assigned to each agent. Internal notes aren&apos;t counted as replies. Rated Great is the share of each agent&apos;s rated replies.</p>
      </section>
    </div>
  );
}
