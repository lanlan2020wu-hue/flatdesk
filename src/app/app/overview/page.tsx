import { and, count, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { db, schema } from "@/db";
import { aiConfigured, aiUsage } from "@/lib/ai";
import { requireOpenPage } from "@/lib/auth";
import { access } from "@/lib/billing";
import { macroUpdates } from "@/lib/macro-drift";
import { macroSuggestions } from "@/lib/macro-suggestions";
import { withAiDrafts } from "@/lib/macro-writer";
import { monthReceipt } from "@/lib/receipts";
import { PLAN, seatPriceFor, usd, type Interval } from "@/lib/pricing";
import { viewCounts } from "@/lib/tickets";

export const metadata = { title: "Overview" };

const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

// A section of the overview: its name on a heavy rule, the link to act on it.
function Section({ title, href, cta, children }: { title: string; href?: string; cta?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-5 border-t border-line pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {href && <Link href={href} className="link text-sm font-medium text-accent">{cta}</Link>}
      </div>
      {children}
    </section>
  );
}

// One figure in a ruled row: the label, then the number in mono.
const Figure = ({ label, value, href, strong = false }: { label: string; value: number; href: string; strong?: boolean }) => (
  <Link href={href} className="group grid gap-1 border-line py-3 transition-colors sm:border-l sm:px-5 sm:first:border-l-0 sm:first:pl-0">
    <span className="text-sm text-muted group-hover:text-ink">{label}</span>
    <span className={`num text-3xl font-medium tracking-tight ${strong && value ? "text-accent" : ""}`}>{value}</span>
  </Link>
);

// The month at a glance, in the order Flatdesk is sold: what the flat rate
// covers this month, then the AI macros waiting, then everything else.
export default async function OverviewPage() {
  const s = await requireOpenPage();
  const [org, ai, found, drifted, [{ aiMacros }], [{ seats }], counts] = await Promise.all([
    db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId) }),
    aiUsage(s.orgId),
    macroSuggestions(s.orgId),
    macroUpdates(s.orgId),
    db.select({ aiMacros: count() }).from(schema.macros).where(and(eq(schema.macros.orgId, s.orgId), eq(schema.macros.source, "suggested"))),
    db.select({ seats: count() }).from(schema.agents).where(and(eq(schema.agents.orgId, s.orgId), eq(schema.agents.viewer, false), isNull(schema.agents.removedAt))),
    viewCounts(s.orgId, s.userId),
  ]);
  const receipt = await monthReceipt(s.orgId, ai.month);
  const aiOn = Boolean(org?.aiEnabled) && aiConfigured();
  const { suggestions } = await withAiDrafts(s.orgId, found);
  const plan = org ? access(org) : ({ state: "open" } as const);
  const interval: Interval = org?.billingInterval === "year" ? "year" : "month";
  const billed = org?.billedSeats ?? Number(seats);
  const perSeat = seatPriceFor(interval);
  const saved = Number(aiMacros);

  const pct = Math.min(100, Math.round((ai.used / Math.max(1, ai.included)) * 100));

  return (
    <div className="grid max-w-5xl content-start gap-12 px-4 py-6 md:px-8 md:py-8">
      <h1 className="page-title">{monthName(ai.month)}</h1>

      {/* The bill first, on the same green field as the sidebar: the price, and what it has covered. */}
      <section className="grid gap-8 rounded-[8px] bg-field p-6 text-field-ink sm:p-8 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:items-end">
        <div className="grid gap-2">
          <h2 className="text-sm font-semibold text-field-muted">This month&apos;s bill</h2>
          <p className="num text-5xl font-medium tracking-tight sm:text-6xl">
            {plan.state === "trial" ? "$0" : usd(billed * perSeat)}
          </p>
          <p className="text-field-muted">
            {plan.state === "trial"
              ? `Free trial, ${plan.daysLeft} day${plan.daysLeft === 1 ? "" : "s"} left. After that, ${billed} seat${billed === 1 ? "" : "s"} × ${usd(perSeat)}.`
              : `${billed} seat${billed === 1 ? "" : "s"} × ${usd(perSeat)}${interval === "year" ? " billed yearly" : " a month"}. The same next month, however busy it gets.`}
          </p>
        </div>
        <div className="grid gap-3">
          <p className="flex justify-between gap-3 text-sm">
            <span className="text-field-muted">{ai.trial ? "AI answers in the trial" : "AI answers included"}</span>
            <span className="num">
              {ai.used.toLocaleString("en-US")} <span className="text-field-muted">of {ai.included.toLocaleString("en-US")}</span>
            </span>
          </p>
          <span className="h-2 overflow-hidden rounded-full bg-field-line" aria-hidden="true">
            <span className={`block h-full rounded-full ${pct >= 100 ? "bg-warn" : "bg-lime"}`} style={{ width: `${pct}%` }} />
          </span>
          <p className="text-sm text-field-muted">
            {org?.aiOverageEnabled ? `Overage is on at ${usd(PLAN.overageRate, true)} per answer.` : "At the cap the AI pauses. Nothing extra is charged."} AI macros never
            use the allowance.{" "}
            <Link href="/app/receipts" className="link text-field-ink">See the itemized receipt</Link>
          </p>
        </div>
      </section>

      <Section title="AI answers" href={aiOn ? "/app/receipts" : "/app/settings#ai"} cta={aiOn ? "See each answer" : "Turn on AI answers"}>
        <p className="-mt-2 max-w-2xl text-sm text-muted">
          {aiOn
            ? "The AI replies to customers by itself. When a new email or chat comes in, it answers if your facts, macros or help articles cover the question. If not, it leaves the ticket for your team with a note saying why."
            : "AI answers are off, so your team answers every ticket. When they're on, the AI replies to customers by itself whenever your facts, macros or help articles cover the question."}
        </p>
        <div className="grid sm:grid-cols-3">
          <Figure label="Answered by the AI this month" value={receipt.counted} href="/app/receipts" strong />
          <Figure label="Left for your team" value={receipt.notCounted} href="/app/receipts" />
          <Figure label="Included answers left" value={Math.max(0, ai.included - ai.used)} href="/app/settings#ai" />
        </div>
      </Section>

      <Section title="AI macros" href="/app/macros" cta={suggestions.length || drifted.length ? "Review them" : "Open AI macros"}>
        <p className="-mt-2 max-w-2xl text-sm text-muted">
          Macros are saved replies your team sends with one click, on the tickets the AI leaves to them. Flatdesk finds the answers your team keeps retyping,
          and the AI writes each one up for you to check and save.
          {!suggestions.length && !drifted.length && " Nothing is waiting yet. A suggestion appears once the same reply has gone out on 5 tickets."}
        </p>
        <div className="grid sm:grid-cols-3">
          <Figure label="Found, waiting for review" value={suggestions.length} href="/app/macros" strong />
          <Figure label="Update ready from your edits" value={drifted.length} href="/app/macros#macro-updates" strong />
          <Figure label="Saved by your team" value={saved} href="/app/macros" />
        </div>
        {(suggestions.length > 0 || drifted.length > 0) && (
          <ul className="grid divide-y divide-line rounded-[8px] border border-line bg-surface">
            {drifted.slice(0, 2).map((u) => (
              <li key={u.macro.id}>
                <Link href="/app/macros#macro-updates" className="grid gap-0.5 px-4 py-3 text-sm transition-colors hover:bg-accent-soft/50">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">{u.macro.name}</span>
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
                <Link href="/app/macros" className="grid gap-0.5 px-4 py-3 text-sm transition-colors hover:bg-accent-soft/50">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">{m.name}</span>
                    <span className="num shrink-0 text-xs text-muted">new, sent on {m.tickets} tickets</span>
                  </span>
                  <span className="line-clamp-1 text-muted">{m.question ?? m.body}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Inbox" href="/app/inbox" cta="Open the inbox">
        <div className="grid grid-cols-2 sm:grid-cols-4">
          <Figure label="Assigned to you" value={counts.mine} href="/app/inbox?view=mine" strong />
          <Figure label="Unassigned" value={counts.unassigned} href="/app/inbox?view=unassigned" strong />
          <Figure label="Open" value={counts.open} href="/app/inbox?view=open" />
          <Figure label="Pending" value={counts.pending} href="/app/inbox?view=pending" />
        </div>
      </Section>

    </div>
  );
}
