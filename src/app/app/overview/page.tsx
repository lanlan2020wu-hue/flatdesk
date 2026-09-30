import { and, count, eq } from "drizzle-orm";
import Link from "next/link";
import { db, schema } from "@/db";
import { aiUsage } from "@/lib/ai";
import { requireSession } from "@/lib/auth";
import { access } from "@/lib/billing";
import { macroUpdates } from "@/lib/macro-drift";
import { macroSuggestions } from "@/lib/macro-suggestions";
import { withAiDrafts } from "@/lib/macro-writer";
import { PLAN, seatPriceFor, usd, type Interval } from "@/lib/pricing";

export const metadata = { title: "Overview" };

const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

function Meter({ label, used, of }: { label: string; used: number; of: number }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, of)) * 100));
  return (
    <div className="grid gap-1.5 text-sm">
      <p className="flex justify-between gap-3">
        <span className="text-muted">{label}</span>
        <span className="num">
          {used.toLocaleString("en-US")} <span className="text-muted">of {of.toLocaleString("en-US")}</span>
        </span>
      </p>
      <span className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
        <span className={`block h-full rounded-full ${pct >= 100 ? "bg-warn" : "bg-accent"}`} style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

function Chapter({ n, title, href, cta, children, tone = "" }: { n: string; title: string; href: string; cta: string; children: React.ReactNode; tone?: string }) {
  return (
    <section className={`card grid gap-6 p-6 sm:p-8 ${tone}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="eyebrow flex items-center gap-3">
          <span className="num font-display text-2xl text-accent">{n}</span>
          {title}
        </h2>
        <Link href={href} className="link text-sm font-medium text-accent">{cta}</Link>
      </div>
      {children}
    </section>
  );
}

const Stat = ({ label, value, className = "" }: { label: string; value: React.ReactNode; className?: string }) => (
  <div className="grid gap-0.5 rounded-lg bg-surface-2/60 px-4 py-3">
    <dt className="text-sm text-muted">{label}</dt>
    <dd className={`num font-display text-3xl ${className}`}>{value}</dd>
  </div>
);

// The app's landing page, in the order Flatdesk is sold: what the flat rate
// covers this month, then the AI macros waiting, then everything else.
export default async function OverviewPage() {
  const s = await requireSession();
  const [org, ai, found, drifted, [{ aiMacros }], [{ seats }]] = await Promise.all([
    db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId) }),
    aiUsage(s.orgId),
    macroSuggestions(s.orgId),
    macroUpdates(s.orgId),
    db.select({ aiMacros: count() }).from(schema.macros).where(and(eq(schema.macros.orgId, s.orgId), eq(schema.macros.source, "suggested"))),
    db.select({ seats: count() }).from(schema.agents).where(and(eq(schema.agents.orgId, s.orgId), eq(schema.agents.viewer, false))),
  ]);
  const { suggestions } = await withAiDrafts(s.orgId, found);
  const plan = org ? access(org) : ({ state: "open" } as const);
  const interval: Interval = org?.billingInterval === "year" ? "year" : "month";
  const billed = org?.billedSeats ?? Number(seats);
  const perSeat = seatPriceFor(interval);
  const saved = Number(aiMacros);

  return (
    <div className="grid max-w-5xl gap-6 px-4 py-6 md:px-8 md:py-8">
      <header className="grid gap-1.5 pb-2">
        <p className="eyebrow">{monthName(ai.month)} at a glance</p>
        <h1 className="font-display text-3xl sm:text-4xl">One flat rate, and what it covered this month.</h1>
      </header>

      <Chapter n="01" title="Flat rate" href="/app/receipts" cta="See this month's AI receipt" tone="border-accent/40 bg-accent-soft/40">
        <div className="grid gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:items-end">
          <div className="grid gap-1">
            <p className="font-display text-4xl sm:text-5xl">
              {plan.state === "trial" ? `Free trial, ${plan.daysLeft} day${plan.daysLeft === 1 ? "" : "s"} left` : `${usd(billed * perSeat)} a month`}
            </p>
            <p className="text-muted">
              {billed} seat{billed === 1 ? "" : "s"} × {usd(perSeat)}
              {interval === "year" ? " billed yearly" : " a month"}. The same next month, however busy it gets.
            </p>
          </div>
          <div className="grid gap-3">
            <Meter label={ai.trial ? "AI resolutions in the trial" : "AI resolutions included"} used={ai.used} of={ai.included} />
            <p className="text-sm text-muted">
              {org?.aiOverageEnabled ? `Overage is on at ${usd(PLAN.overageRate, true)} per resolution.` : "At the cap the AI pauses. Nothing extra is charged."} AI macros
              never use resolutions.
            </p>
          </div>
        </div>
      </Chapter>

      <Chapter n="02" title="Evolving AI macros" href="/app/macros" cta={suggestions.length || drifted.length ? "Review them" : "Open AI macros"}>
        <div className="grid gap-6 md:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
          <dl className="grid content-start gap-3">
            <Stat label="Identified, waiting for review" value={suggestions.length} className={suggestions.length ? "text-accent" : ""} />
            <Stat label="Your team changed, update ready" value={drifted.length} className={drifted.length ? "text-accent" : ""} />
            <Stat label="Saved by your team" value={saved} />
          </dl>
          {suggestions.length || drifted.length ? (
            <ul className="grid self-start divide-y divide-line rounded-xl border border-line">
              {drifted.slice(0, 2).map((u) => (
                <li key={u.macro.id}>
                  <Link href="/app/macros#macro-updates" className="grid gap-0.5 px-4 py-3 text-sm transition-colors hover:bg-surface-2/60">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">{u.macro.name}</span>
                      <span className="pill shrink-0 bg-accent-soft text-xs text-accent">Update ready</span>
                    </span>
                    <span className="line-clamp-1 text-muted">
                      Your team edits it the same way before sending: {[...u.drift.added.map((a) => a.text), ...u.drift.changed.map((c) => c.to), ...u.drift.removed.map((r) => `deletes "${r.text}"`)][0]}
                    </span>
                  </Link>
                </li>
              ))}
              {suggestions.slice(0, 4 - Math.min(2, drifted.length)).map((m) => (
                <li key={m.key}>
                  <Link href="/app/macros" className="grid gap-0.5 px-4 py-3 text-sm transition-colors hover:bg-surface-2/60">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">{m.name}</span>
                      <span className="num shrink-0 text-xs text-muted">new, sent on {m.tickets} tickets</span>
                    </span>
                    <span className="line-clamp-1 text-muted">{m.question ?? m.body}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">
              When your team sends the same answer on 5 tickets, it shows up here, written up by the AI. When they keep editing a macro the same way, the AI
              updates it, so your macros evolve with the business. Saved macros are offered on new tickets and can assign, tag, close and send.
            </p>
          )}
        </div>
      </Chapter>

      <section className="grid gap-3 pt-2">
        <h2 className="eyebrow flex items-center gap-3">
          <span className="num font-display text-2xl text-accent">03</span>
          Everything else in your seat
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { href: "/app/receipts", title: "AI receipts", body: "Every AI answer itemized, refundable." },
            { href: "/app/test-drive", title: "AI test drive", body: "AI drafts for your past tickets." },
            { href: "/app/help", title: "Help center", body: "Articles your customers and the AI use." },
            { href: "/app/reports", title: "Reports", body: "Volume, response times and AI share." },
            { href: "/app/inbox", title: "Inbox", body: "Email and chat in one queue." },
          ].map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="flex h-full flex-col gap-1 rounded-xl border border-line bg-surface px-4 py-3 text-sm transition-colors hover:border-line-strong">
                <span className="font-medium">{l.title}</span>
                <span className="text-muted">{l.body}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
