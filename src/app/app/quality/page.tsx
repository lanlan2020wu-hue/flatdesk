import Link from "next/link";
import { after } from "next/server";
import { aiConfigured } from "@/lib/ai";
import { requireSession } from "@/lib/auth";
import { timeAgo } from "@/lib/format";
import { QUALITY, pendingReplies, qualityRoom, qualitySummary, reviewPending } from "@/lib/quality";

export const metadata = { title: "Quality review" };

const PERIODS = [7, 30, 90];

const tone = (score: number) => (score >= 4 ? "text-accent" : score > QUALITY.flagAt ? "text-ink" : "text-warn");

export default async function QualityPage({ searchParams }: PageProps<"/app/quality">) {
  const s = await requireSession();
  const sp = await searchParams;
  const days = PERIODS.includes(Number(sp.days)) ? Number(sp.days) : 30;
  const [q, room, waiting] = await Promise.all([qualitySummary(s.orgId, days), qualityRoom(s.orgId), pendingReplies(s.orgId, 50)]);
  const on = aiConfigured();
  // Catch up on replies that haven't been graded yet, after this page is sent.
  if (on && waiting.length) after(() => reviewPending(s.orgId));

  return (
    <div className="grid max-w-5xl gap-8 px-4 py-6 md:px-8 md:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1.5">
          <p className="eyebrow">AI, included</p>
          <h1 className="font-display text-3xl">Quality review</h1>
          <p className="max-w-2xl text-muted">
            The AI grades every reply sent to a customer, by your team or by AI answers, against your own macros, notes and help center:
            accuracy, tone, and whether it solved the problem. Weak replies are flagged with what to fix.
          </p>
        </div>
        <nav aria-label="Period" className="flex gap-0.5 rounded-lg bg-surface-2 p-0.5 text-sm">
          {PERIODS.map((d) => (
            <Link key={d} href={`/app/quality?days=${d}`} aria-current={d === days ? "page" : undefined} className={`rounded-md px-3 py-1 ${d === days ? "bg-surface font-medium shadow-sm" : "text-muted hover:text-ink"}`}>
              {d} days
            </Link>
          ))}
        </nav>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="card grid gap-1 p-5">
          <p className="text-sm text-muted">Team score</p>
          <p className={`num font-display text-4xl ${q.average != null ? tone(q.average) : ""}`}>{q.average != null ? q.average.toFixed(1) : "–"}<span className="text-lg text-muted"> / 5</span></p>
        </div>
        <div className="card grid gap-1 p-5">
          <p className="text-sm text-muted">Replies reviewed</p>
          <p className="num font-display text-4xl">{q.reviewed}</p>
        </div>
        <div className="card grid gap-1 p-5">
          <p className="text-sm text-muted">Flagged</p>
          <p className={`num font-display text-4xl ${q.flagged ? "text-warn" : ""}`}>{q.flagged}</p>
        </div>
      </section>

      {!on && <p className="rounded-xl border border-dashed border-line-strong px-4 py-3 text-sm text-muted">Quality review starts once AI is set up on this workspace.</p>}
      {on && waiting.length > 0 && (
        <p className="text-sm text-muted">
          {waiting.length >= 50 ? "50 or more" : waiting.length} recent {waiting.length === 1 ? "reply is" : "replies are"} waiting to be graded. They&apos;re picked up in the background.
        </p>
      )}

      <section className="grid gap-3">
        <h2 className="eyebrow">Scorecards</h2>
        {q.cards.length ? (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr className="border-b border-line">
                  <th className="px-5 py-3 font-normal">Who</th>
                  <th className="px-5 py-3 text-right font-normal">Reviewed</th>
                  <th className="px-5 py-3 text-right font-normal">Average</th>
                  <th className="px-5 py-3 text-right font-normal">Flagged</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {q.cards.map((c) => (
                  <tr key={c.key}>
                    <td className="px-5 py-3 font-medium">{c.name}</td>
                    <td className="num px-5 py-3 text-right">{c.reviewed}</td>
                    <td className={`num px-5 py-3 text-right font-medium ${tone(c.average)}`}>{c.average.toFixed(1)}</td>
                    <td className={`num px-5 py-3 text-right ${c.flagged ? "text-warn" : "text-muted"}`}>{c.flagged}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">No replies reviewed in the last {days} days yet.</p>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="eyebrow">Flagged replies</h2>
        {q.flaggedReplies.length ? (
          <ul className="grid gap-3">
            {q.flaggedReplies.map((r) => (
              <li key={r.id} className="card grid gap-1.5 border-warn/30 p-4 text-sm">
                <p className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/app/tickets/${r.number}`} className="link font-medium">
                    <span className="num">#{r.number}</span> {r.subject}
                  </Link>
                  <span className="text-xs text-muted">
                    {r.author} · <span className="num text-warn">{r.overall}/5</span> · {timeAgo(r.at)}
                  </span>
                </p>
                {r.issue && <p>{r.issue}</p>}
                <p className="text-muted">Coaching: {r.note}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nothing flagged in the last {days} days.</p>
        )}
      </section>

      <p className="text-xs text-muted">
        Included in the seat: {room.used.toLocaleString("en-US")} of {room.limit.toLocaleString("en-US")} reviews used this month ({QUALITY.perAgent} per seat, pooled). Reviews never use AI resolutions.
      </p>
    </div>
  );
}
