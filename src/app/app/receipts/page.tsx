import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { monthKey } from "@/lib/ai";
import { PLAN, usd } from "@/lib/pricing";
import { monthReceipt, receiptMonths, refundOpen, STATUS_LABEL, type ReceiptStatus } from "@/lib/receipts";
import { refundAction } from "./actions";

export const metadata = { title: "AI receipts" };

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
  const s = await requireSession();
  const sp = await searchParams;
  const raw = typeof sp.month === "string" ? sp.month : "";
  const month = /^\d{4}-\d{2}$/.test(raw) ? raw : monthKey();
  const [r, months, canRefund] = await Promise.all([monthReceipt(s.orgId, month), receiptMonths(s.orgId), refundOpen(s.orgId, month)]);
  const isAdmin = s.role === "admin";
  const error = typeof sp.error === "string" ? sp.error : null;
  const refunded = typeof sp.refunded === "string" ? sp.refunded : null;
  const pct = Math.min(100, Math.round((r.counted / r.included) * 100));

  return (
    <div className="grid max-w-5xl gap-8 px-4 py-6 md:px-8 md:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1.5">
          <p className="eyebrow">Billing transparency</p>
          <h1 className="font-display text-3xl">AI receipts</h1>
          <p className="max-w-xl text-muted">
            Every answer the AI sent, itemized. Only counted lines use your allowance. If the AI got one wrong, refund it and it stops
            counting{canRefund ? "" : " (refunds close once a month is billed)"}.
          </p>
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
            <Line label="Counted resolutions" value={r.counted.toLocaleString("en-US")} />
            <div className="my-1.5 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
              <span className={`meter block h-full rounded-full ${pct >= 100 ? "bg-warn" : "bg-accent"}`} style={{ width: `${pct}%` }} />
            </div>
            <Line label="Not counted (customer wrote back or handed off)" value={r.notCounted.toLocaleString("en-US")} className="text-muted" />
            <Line label="Refunded by your team" value={r.refunded.toLocaleString("en-US")} className="text-muted" />
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
                  {isAdmin && canRefund && (l.status === "included" || l.status === "overage") && (
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
