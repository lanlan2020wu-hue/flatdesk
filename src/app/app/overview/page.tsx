import { and, count, eq } from "drizzle-orm";
import Link from "next/link";
import { db, schema } from "@/db";
import { aiUsage } from "@/lib/ai";
import { requireSession } from "@/lib/auth";
import { access } from "@/lib/billing";
import { copilotBreakdown, copilotUsage } from "@/lib/copilot";
import { macroSuggestions } from "@/lib/macro-suggestions";
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

function Pillar({ n, title, lede, children, href, cta }: { n: string; title: string; lede: string; children: React.ReactNode; href: string; cta: string }) {
  return (
    <section className="card flex flex-col gap-5 p-6">
      <div className="grid gap-1.5">
        <p className="flex items-center justify-between">
          <span className="eyebrow">{title}</span>
          <span className="num font-display text-xl text-accent/60">{n}</span>
        </p>
        <p className="font-display text-2xl leading-snug">{lede}</p>
      </div>
      <div className="grid gap-4">{children}</div>
      <Link href={href} className="link mt-auto w-max text-sm font-medium text-accent">{cta}</Link>
    </section>
  );
}

// What the team gets for its flat price this month: the bill, the AI macros
// Flatdesk found, and what the copilot did. The three things Flatdesk sells.
export default async function OverviewPage() {
  const s = await requireSession();
  const [org, ai, copilot, used, suggestions, [{ aiMacros }], [{ seats }]] = await Promise.all([
    db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId) }),
    aiUsage(s.orgId),
    copilotUsage(s.orgId),
    copilotBreakdown(s.orgId),
    macroSuggestions(s.orgId),
    db.select({ aiMacros: count() }).from(schema.macros).where(and(eq(schema.macros.orgId, s.orgId), eq(schema.macros.source, "suggested"))),
    db.select({ seats: count() }).from(schema.agents).where(and(eq(schema.agents.orgId, s.orgId), eq(schema.agents.viewer, false))),
  ]);
  const plan = org ? access(org) : ({ state: "open" } as const);
  const interval: Interval = org?.billingInterval === "year" ? "year" : "month";
  const billed = org?.billedSeats ?? Number(seats);
  const perSeat = seatPriceFor(interval);

  return (
    <div className="grid max-w-6xl gap-8 px-4 py-6 md:px-8 md:py-8">
      <header className="grid gap-1.5">
        <p className="eyebrow">{monthName(ai.month)} at a glance</p>
        <h1 className="font-display text-3xl sm:text-4xl">Everything in your seat, working.</h1>
        <p className="max-w-2xl text-muted">One flat price covers the help desk, AI macros identified automatically from your team&apos;s replies, and an AI copilot for every agent.</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <Pillar
          n="01"
          title="Flat rate"
          lede={plan.state === "trial" ? `Free trial, ${plan.daysLeft} day${plan.daysLeft === 1 ? "" : "s"} left` : `${usd(billed * perSeat)} a month, every month`}
          href="/app/receipts"
          cta="See this month's AI receipt"
        >
          <p className="text-sm text-muted">
            {billed} seat{billed === 1 ? "" : "s"} × {usd(perSeat)}
            {interval === "year" ? " billed yearly" : " a month"}. Every feature on this page is included, with no AI meter.
          </p>
          <Meter label={ai.trial ? "AI resolutions in the trial" : "AI resolutions included"} used={ai.used} of={ai.included} />
          <p className="text-sm text-muted">
            {org?.aiOverageEnabled ? `Overage is on at ${usd(PLAN.overageRate, true)} per resolution.` : "At the cap the AI pauses. Nothing extra is charged."}
          </p>
        </Pillar>

        <Pillar
          n="02"
          title="AI macros"
          lede={suggestions.length ? `${suggestions.length} new macro${suggestions.length === 1 ? "" : "s"} identified` : `${Number(aiMacros)} AI macro${Number(aiMacros) === 1 ? "" : "s"} in use`}
          href="/app/macros"
          cta={suggestions.length ? "Review and save them" : "Open AI macros"}
        >
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="grid gap-0.5 rounded-lg bg-surface-2/60 px-3 py-2.5">
              <dt className="text-muted">Waiting for review</dt>
              <dd className="num font-display text-2xl">{suggestions.length}</dd>
            </div>
            <div className="grid gap-0.5 rounded-lg bg-surface-2/60 px-3 py-2.5">
              <dt className="text-muted">Saved by your team</dt>
              <dd className="num font-display text-2xl">{Number(aiMacros)}</dd>
            </div>
          </dl>
          <p className="text-sm text-muted">
            {suggestions[0]
              ? `Top of the list: "${suggestions[0].name}", sent on ${suggestions[0].tickets} tickets.`
              : "When your team sends the same answer on 5 tickets, it shows up here, written up by the AI."}{" "}
            Saved macros are offered on new tickets that ask the same thing. None of this uses AI resolutions.
          </p>
        </Pillar>

        <Pillar
          n="03"
          title="AI copilot"
          lede={`${copilot.used} copilot action${copilot.used === 1 ? "" : "s"} this month`}
          href="/app/inbox"
          cta="Open a ticket to use it"
        >
          <Meter label="Included this month" used={copilot.used} of={copilot.limit} />
          <dl className="grid grid-cols-3 gap-2 text-sm">
            {(
              [
                ["Summaries", used.summary],
                ["Drafts", used.draft],
                ["Rewrites", used.rewrite],
              ] as const
            ).map(([label, n]) => (
              <div key={label} className="grid gap-0.5 rounded-lg bg-surface-2/60 px-3 py-2">
                <dt className="text-muted">{label}</dt>
                <dd className="num font-display text-xl">{n}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-muted">Summaries, drafted replies and rewrites on every ticket. Zendesk sells its copilot as a paid add-on; yours is in the seat.</p>
        </Pillar>
      </div>

      <section className="grid gap-3">
        <h2 className="eyebrow">Also in your seat</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { href: "/app/receipts", title: "AI receipts", body: "Every AI answer itemized, refundable." },
            { href: "/app/test-drive", title: "AI test drive", body: "AI drafts for your past tickets." },
            { href: "/app/help", title: "Help center", body: "Articles your customers and the AI use." },
            { href: "/app/reports", title: "Reports", body: "Volume, response times and AI share." },
          ].map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="flex h-full flex-col gap-0.5 rounded-xl border border-line bg-surface px-4 py-3 text-sm transition-colors hover:border-line-strong">
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
