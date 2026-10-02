import { eq } from "drizzle-orm";
import Link from "next/link";
import HowItWorks from "@/components/HowItWorks";
import { requireOpenPage } from "@/lib/auth";
import { db, schema } from "@/db";
import { aiConfigured, monthKey } from "@/lib/ai";
import { PLAN, usd } from "@/lib/pricing";
import { monthReceipt, receiptMonths, refundOpen, STATUS_LABEL, type ReceiptStatus } from "@/lib/receipts";
import { refundAction } from "./actions";

export const metadata = { title: "AI answers" };

const TONE: Record<ReceiptStatus, string> = {
  included: "pill bg-accent-soft text-accent",
  overage: "pill bg-warn-soft text-warn",
  refunded: "pill bg-surface-2 text-muted line-through decoration-1",
  "customer-replied": "pill bg-surface-2 text-muted",
  "handed-off": "pill bg-surface-2 text-muted",
};

const monthName = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

function Line({ label, value, className = "" }: { label: React.ReactNode; value: React.ReactNode; className?: string }) {
  return (
    <div className={`flex justify-between gap-4 ${className}`}>
      <span>{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

export default async function ReceiptsPage({ searchParams }: PageProps<"/app/receipts">) {
  const s = await requireOpenPage();
  const sp = await searchParams;
  const raw = typeof sp.month === "string" ? sp.month : "";
  const month = /^\d{4}-\d{2}$/.test(raw) ? raw : monthKey();
  const [r, months, canRefund] = await Promise.all([monthReceipt(s.orgId, month), receiptMonths(s.orgId), refundOpen(s.orgId, month)]);
  const isAdmin = s.role === "admin";
  const error = typeof sp.error === "string" ? sp.error : null;
  const refunded = typeof sp.refunded === "string" ? sp.refunded : null;
  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId) });
  const aiOn = Boolean(org?.aiEnabled) && aiConfigured();
  const pct = Math.min(100, Math.round((r.counted / r.included) * 100));

  return (
    <div className="grid max-w-5xl gap-8 px-4 py-6 md:px-8 md:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1.5">
          <h1 className="page-title">AI answers</h1>
          <p className="max-w-xl text-muted">
            The AI replies to customers by itself, by email and in the chat. This is its receipt: every ticket it answered or handed to your team. Only counted lines use your allowance. If the AI got one wrong, refund it and it stops
            counting{canRefund ? "" : " (refunds close once a month is billed)"}.
          </p>
          {canRefund && r.refundsLeft === 0 && (
            <p className="max-w-xl text-sm text-muted">
              This month&apos;s {r.refundLimit} refunds are used up. Refunds are capped at one in five of your included answers, so if the AI keeps getting things wrong, fix the facts or macros it uses in Settings or turn AI answers off.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form className="flex items-center gap-2" action="/app/receipts">
            <label htmlFor="month" className="sr-only">Month</label>
            <select id="month" name="month" defaultValue={month} className="field field-sm w-auto">
              {months.map((m) => (
                <option key={m} value={m}>{monthName(m)}</option>
              ))}
            </select>
            <button className="btn btn-secondary btn-sm">Show</button>
          </form>
          <a href={`/app/receipts/export?month=${month}`} className="btn btn-secondary btn-sm" download>
            Download CSV
          </a>
        </div>
      </header>

      <p className={`rounded-lg px-4 py-3 text-sm ${aiOn ? "bg-accent-soft" : "bg-surface-2 text-muted"}`}>
        {aiOn ? (
          <>
            <strong className="font-medium">AI answers are on.</strong> New email and chat tickets get a reply from the AI when your facts, macros or help articles
            cover the question.
          </>
        ) : (
          <>AI answers are off, so your team answers every ticket.</>
        )}{" "}
        {isAdmin ? <Link href="/app/settings#ai" className="link text-accent">{aiOn ? "Change what the AI knows" : "Turn them on in Settings"}</Link> : "An admin can change this in Settings."}
      </p>

      <HowItWorks
        title="How AI answers and receipts work"
        open={r.lines.length === 0}
        summary={`Your plan includes ${PLAN.includedPerAgent} AI answers per agent each month, shared by the team. This page shows where each one went, like an itemized bill.`}
        steps={[
          { title: "The AI replies on its own", body: "When a new email or chat comes in, it answers if your macros, help articles or the facts you gave it in Settings cover the question. Nobody has to click anything." },
          { title: "A line is added here", body: "Every ticket the AI touched gets a line, with the macros and articles it used." },
          { title: "Only finished answers count", body: "If the AI hands a ticket to your team, before or after replying, that line doesn't count. Only answers that settle the question without your team use the allowance." },
          { title: "Refund a wrong answer", body: `If the AI got one wrong, an admin clicks Refund and reopen. It stops counting and the ticket goes back to your team as open. Each month you can refund up to one in five of your included answers (${r.refundLimit} this month).` },
        ]}
        example="a customer asks for your opening hours and the AI answers from the facts you gave it. That's one counted line. Another customer asks to cancel their account and the AI hands it to your team. That line is free."
      />

      {error && <p role="alert" className="rounded-lg border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">{error}</p>}
      {refunded && !error && (
        <p role="status" className="rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-sm">
          Refunded. That answer no longer counts, and its ticket is back in the open queue.
        </p>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
        <figure className="receipt-shadow lg:sticky lg:top-6">
          <div className="receipt num grid gap-1.5 px-6 pt-8 pb-9 text-[13px]">
            <figcaption className="mb-3 grid gap-1 text-center font-sans">
              <span className="eyebrow">AI statement</span>
              <span className="font-display text-xl">{monthName(month)}</span>
            </figcaption>
            <div className="rule-dashed mb-2" />
            <Line label="Included this month" value={r.included.toLocaleString("en-US")} />
            <Line label="Counted AI answers" value={r.counted.toLocaleString("en-US")} />
            <div className="my-1.5 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
              <span className={`meter block h-full rounded-full ${pct >= 100 ? "bg-warn" : "bg-accent"}`} style={{ width: `${pct}%` }} />
            </div>
            <Line label="Not counted (handed to the team)" value={r.notCounted.toLocaleString("en-US")} className="text-muted" />
            <Line label="Refunded by your team" value={r.refunded.toLocaleString("en-US")} className="text-muted" />
            <Line label="Refunds left this month" value={`${r.refundsLeft} of ${r.refundLimit}`} className="text-muted" />
            <div className="rule-dashed my-3" />
            <Line label={`Overage, ${r.overage} × ${usd(PLAN.overageRate, true)}`} value={usd(r.overageUsd, true)} />
            <div className="mt-2 flex items-baseline justify-between gap-4 rounded-lg bg-accent-soft px-3 py-2.5 font-medium text-accent">
              <span>AI charges this month</span>
              <span className="text-base">{usd(r.overageUsd, true)}</span>
            </div>
            <p className="mt-3 text-center font-sans text-xs text-muted">
              Overage only applies if an admin turned it on in Settings.
            </p>
          </div>
        </figure>

        <section className="grid gap-3" aria-label="Line items">
          <h2 className="flex items-baseline justify-between font-medium">
            Line items <span className="num text-sm font-normal text-muted">{r.lines.length}</span>
          </h2>
          {r.lines.length === 0 ? (
            <div className="card grid gap-2 p-6 text-muted">
              <p>No AI activity in {monthName(month)} yet.</p>
              <p className="text-sm">
                When the AI answers a ticket it shows up here with the saved answers it used. Turn it on in{" "}
                <Link href="/app/settings" className="link text-accent">Settings</Link>.
              </p>
            </div>
          ) : (
            <ol className="card divide-y divide-line overflow-hidden">
              {r.lines.map((l) => (
                <li key={l.id} id={`e-${l.id}`} className={`grid scroll-mt-6 gap-2 px-4 py-3.5 sm:px-5 ${refunded === l.id ? "bg-accent-soft/60" : ""}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      {l.ticketNumber != null ? (
                        <Link href={`/app/tickets/${l.ticketNumber}`} className="num text-sm text-muted hover:text-ink">#{l.ticketNumber}</Link>
                      ) : (
                        <span className="num text-sm text-muted">deleted</span>
                      )}
                      <span className="truncate font-medium">{l.subject ?? "Ticket removed"}</span>
                    </span>
                    <span className={TONE[l.status]}>{STATUS_LABEL[l.status]}</span>
                  </div>
                  <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
                    <time className="num" dateTime={l.at.toISOString()}>
                      {l.at.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC
                    </time>
                    {l.customer && <span className="truncate">{l.customer}</span>}
                  </p>
                  {l.reason && <p className="text-sm">{l.reason}</p>}
                  {l.sources.length > 0 && (
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      Used
                      {l.sources.map((src) => (
                        <span key={src} className="chip">{src}</span>
                      ))}
                    </p>
                  )}
                  {l.status === "refunded" && (
                    <p className="text-sm text-muted">
                      Refunded{l.refundedByName ? ` by ${l.refundedByName}` : ""}
                      {l.refundNote ? `: ${l.refundNote}` : "."}
                    </p>
                  )}
                  {isAdmin && canRefund && r.refundsLeft > 0 && (l.status === "included" || l.status === "overage") && (
                    <details className="group">
                      <summary className="w-max cursor-pointer text-sm text-muted transition-colors hover:text-ink">
                        The AI got this wrong
                      </summary>
                      <form action={refundAction} className="mt-2 flex flex-wrap gap-2">
                        <input type="hidden" name="eventId" value={l.id} />
                        <input type="hidden" name="month" value={month} />
                        <label htmlFor={`note-${l.id}`} className="sr-only">What was wrong</label>
                        <input id={`note-${l.id}`} name="note" maxLength={500} placeholder="What was wrong? (optional)" className="field field-sm min-w-0 flex-1" />
                        <button className="btn btn-secondary btn-sm">Refund and reopen</button>
                      </form>
                    </details>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
