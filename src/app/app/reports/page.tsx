import Link from "next/link";
import { requireOpenPage } from "@/lib/auth";
import { targetLabel } from "@/lib/sla";
import { duration, REPORT_RANGES, type ReportRange, teamReport } from "@/lib/reports";
import InsightsButton from "@/components/InsightsButton";
import { aiConfigured } from "@/lib/ai";
import { timeAgo } from "@/lib/format";
import { INSIGHTS, latestInsight, nextRunAt, topicStats } from "@/lib/insights";

export const metadata = { title: "Reports" };
// Insights can take up to a minute to read the tickets.
export const maxDuration = 180;

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
  const s = await requireOpenPage();
  const { days: raw } = await searchParams;
  const days = (REPORT_RANGES.find((d) => String(d) === raw) ?? 30) as ReportRange;
  const [r, insight] = await Promise.all([teamReport(s.orgId, days), latestInsight(s.orgId)]);
  const topics = insight ? await topicStats(s.orgId, insight.topics) : null;
  const canRefresh = aiConfigured() && !nextRunAt(insight);
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
              ? `${r.target.met} on time, ${r.target.missed} late${r.target.minutes ? ` against ${targetLabel(r.target.minutes)}` : ""}${r.target.policies ? ` and ${r.target.policies} tag ${r.target.policies === 1 ? "policy" : "policies"}` : ""}. Imported tickets aren't counted.`
              : "No first-reply target set. Add one in Settings."
          }
        />
        {r.target?.resolve && (
          <Tile
            label="Resolved on target"
            value={pct(r.target.resolve.share)}
            note={`${r.target.resolve.met} closed in time, ${r.target.resolve.missed} late${r.target.resolve.minutes ? ` against ${targetLabel(r.target.resolve.minutes)}` : ""}. Pending time counts.`}
          />
        )}
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

      <section id="insights" className="grid scroll-mt-6 gap-4">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">What customers ask about</h2>
          <p className="text-muted">
            The AI reads up to {INSIGHTS.maxTickets} recent tickets and groups them by what customers want. For each topic you see how much the AI handled,
            why it handed some to your team, and one thing to fix. Included in the seat; it doesn&apos;t use AI answers or copilot actions.
          </p>
        </div>
        {insight && topics ? (
          <>
            <p className="text-sm text-muted">
              From {insight.tickets} tickets in the {insight.days} days before {timeAgo(insight.createdAt)}.{canRefresh ? "" : ` Refreshes every ${INSIGHTS.everyHours} hours.`}
            </p>
            {insight.notes.length > 0 && (
              <ul className="grid gap-1 rounded-lg bg-accent-soft px-4 py-3 text-sm">
                {insight.notes.map((n) => <li key={n}>{n}</li>)}
              </ul>
            )}
            <ol className="grid divide-y divide-line border-y border-line">
              {topics.map((t) => (
                <li key={t.name} className="grid gap-2 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-semibold">{t.name}</h3>
                    <span className="num text-sm text-muted">
                      {t.count} {t.count === 1 ? "ticket" : "tickets"} · AI answered {t.ai} · handed to team {t.handedOff} · not closed {t.open}
                    </span>
                  </div>
                  <p className="text-sm">{t.summary}</p>
                  {t.gap && <p className="text-sm text-muted"><span className="font-medium text-ink">Why the AI handed off:</span> {t.gap}</p>}
                  {t.suggestion && <p className="text-sm text-muted"><span className="font-medium text-accent">Try:</span> {t.suggestion}</p>}
                  <details className="text-sm">
                    <summary className="w-max cursor-pointer text-muted">Examples</summary>
                    <ul className="mt-1 grid gap-0.5">
                      {t.examples.map((e) => (
                        <li key={e.number}>
                          <Link href={`/app/tickets/${e.number}`} className="link">#{e.number} {e.subject}</Link>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="text-sm text-muted">No insights yet for your team.</p>
        )}
        {!s.viewer && canRefresh && <InsightsButton days={days} label={topics ? `Refresh for the last ${days} days` : `Find topics in the last ${days} days`} />}
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
