// Small, static drawings of Flatdesk's own screens for the feature tour.
// The data in them is made up; the layouts match the real app.

import { PLAN, usd } from "@/lib/pricing";

export function FeatureIcon({ d, className = "size-9 p-2 bg-accent-soft" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} shrink-0 rounded-lg text-accent`} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function Bar({ title }: { title: string }) {
  return (
    <div className="shot-bar">
      <i />
      <i />
      <i />
      <span className="ml-2 text-xs text-muted">{title}</span>
    </div>
  );
}

const Dot = ({ className }: { className: string }) => <span className={`size-1.5 shrink-0 rounded-full ${className}`} />;

export function InboxShot() {
  const rows: [string, string, string, string, string][] = [
    ["1042", "Can't reset my password", "Ana Ruiz", "email", "AI answered"],
    ["1041", "Refund for order #5531", "Tom Becker", "chat", "Sam"],
    ["1040", "Invoice shows wrong VAT", "Priya N.", "email", "Sam"],
    ["1039", "How do I add a teammate?", "Lee Park", "chat", "Unassigned"],
  ];
  return (
    <div className="shot" aria-hidden="true">
      <Bar title="Inbox · All open" />
      <div className="grid grid-cols-[92px_1fr]">
        <div className="grid content-start gap-0.5 border-r border-line p-2 text-[11px] text-muted">
          {["Assigned to me", "Unassigned", "All open", "Pending"].map((v, i) => (
            <span key={v} className={`rounded px-1.5 py-1 ${i === 2 ? "bg-accent-soft font-medium text-ink" : ""}`}>{v}</span>
          ))}
        </div>
        <ul className="divide-y divide-line">
          {rows.map(([n, subject, who, ch, owner]) => (
            <li key={n} className="grid gap-0.5 px-3 py-2">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{subject}</span>
                <span className="chip shrink-0">{ch}</span>
              </span>
              <span className="flex justify-between gap-2 text-[11px] text-muted">
                <span className="num">#{n} · {who}</span>
                <span>{owner}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function MacroShot() {
  return (
    <div className="shot" aria-hidden="true">
      <Bar title="Macros and rules" />
      <div className="grid gap-3 p-3">
        <div className="grid gap-1.5 rounded-lg border border-line p-2.5">
          <span className="flex items-center justify-between">
            <span className="font-medium">Refund policy</span>
            <span className="flex gap-1">
              <span className="chip">+ billing</span>
              <span className="chip">→ pending</span>
            </span>
          </span>
          <span className="text-[12px] text-muted">Hi {"{first name}"}, refunds go back to the original card within 5 business days…</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-accent/40 bg-accent-soft/60 p-2.5 text-[12px]">
          <span className="text-muted">If tagged</span>
          <span className="chip">billing</span>
          <span className="text-muted">assign to</span>
          <span className="rounded-md bg-surface px-1.5 py-0.5 font-medium shadow-sm">Sam</span>
          <span className="ml-auto pill bg-accent-soft text-accent">On</span>
        </div>
      </div>
    </div>
  );
}

export function AiShot() {
  return (
    <div className="shot" aria-hidden="true">
      <Bar title="#1042 · Can't reset my password" />
      <div className="grid gap-2.5 p-3">
        <p className="rounded-xl rounded-tl-sm border border-line bg-surface px-3 py-2">The reset link says it expired. Can you help?</p>
        <p className="rounded-xl rounded-tl-sm border border-accent/30 bg-accent-soft px-3 py-2">
          Hi Ana, reset links last 30 minutes. Request a new one from the sign-in page and use it right away…
          <span className="mt-1.5 flex items-center gap-1.5 border-t border-accent/20 pt-1.5 text-[11px] text-muted">
            Receipt · Counted, included · used <span className="chip">Password reset</span>
          </span>
        </p>
        <div className="grid gap-1 pt-1">
          <span className="flex justify-between text-[11px] text-muted">
            <span>AI allowance this month</span>
            <span className="num">612 / 1,000</span>
          </span>
          <span className="h-1.5 overflow-hidden rounded-full bg-line">
            <span className="meter block h-full w-[61%] rounded-full bg-accent" />
          </span>
        </div>
      </div>
    </div>
  );
}

export function ReceiptShot() {
  const lines: [string, string, string, string][] = [
    ["#1042", "Can't reset my password", "Counted, included", "pill bg-accent-soft text-accent"],
    ["#1038", "Where is my order?", "Not counted, customer wrote back", "pill bg-surface-2 text-muted"],
    ["#1035", "Change billing email", "Refunded", "pill bg-surface-2 text-muted line-through"],
  ];
  return (
    <div className="shot" aria-hidden="true">
      <Bar title="AI receipts · September 2026" />
      <ol className="divide-y divide-line">
        {lines.map(([n, subject, status, tone]) => (
          <li key={n} className="grid gap-1 px-3 py-2.5">
            <span className="flex items-center justify-between gap-2">
              <span className="truncate">
                <span className="num text-muted">{n}</span> <span className="font-medium">{subject}</span>
              </span>
              <span className={`${tone} shrink-0 text-[10px]`}>{status}</span>
            </span>
            {n === "#1042" && (
              <span className="flex items-center justify-between text-[11px] text-muted">
                <span>used <span className="chip">Password reset</span></span>
                <span className="rounded-md border border-line-strong bg-surface px-1.5 py-0.5 text-ink">Refund and reopen</span>
              </span>
            )}
          </li>
        ))}
      </ol>
      <div className="num flex justify-between border-t border-dashed border-line-strong bg-surface-2 px-3 py-2 text-[12px]">
        <span>AI charges this month</span>
        <span className="font-medium">{usd(0, true)}</span>
      </div>
    </div>
  );
}

export function ChatShot() {
  return (
    <div className="relative h-full min-h-56" aria-hidden="true">
      <div className="shot absolute right-12 bottom-12 w-[270px] max-w-[calc(100%-3rem)]">
        <div className="flex items-center gap-2 bg-accent px-3 py-2 text-accent-ink">
          <Dot className="bg-accent-ink" />
          <span className="text-[12px] font-medium">Chat with Acme support</span>
        </div>
        <div className="grid gap-2 p-2.5 text-[12px]">
          <p className="max-w-[85%] justify-self-start rounded-xl rounded-bl-sm bg-surface-2 px-2.5 py-1.5">Do you ship to Canada?</p>
          <p className="max-w-[85%] justify-self-end rounded-xl rounded-br-sm bg-accent-soft px-2.5 py-1.5">Yes, 3–5 business days. Rates show at checkout.</p>
          <p className="rounded-md border border-line px-2 py-1.5 text-muted">Write a message…</p>
        </div>
      </div>
      <span className="absolute right-0 bottom-0 grid size-10 place-items-center rounded-full bg-accent text-accent-ink shadow-lg">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>
      </span>
    </div>
  );
}

export function ReportShot() {
  const bars = [38, 52, 44, 61, 57, 73, 66, 49, 58, 70, 64, 81];
  return (
    <div className="shot" aria-hidden="true">
      <Bar title="Reports · Last 30 days" />
      <div className="grid gap-3 p-3">
        <div className="grid grid-cols-3 gap-2">
          {[
            ["New tickets", "1,284"],
            ["First response", "38m"],
            ["Answered by AI", "41%"],
          ].map(([l, v]) => (
            <span key={l} className="grid rounded-lg border border-line px-2 py-1.5">
              <span className="text-[10px] text-muted">{l}</span>
              <span className="num font-display text-lg">{v}</span>
            </span>
          ))}
        </div>
        <div className="chart flex h-20 items-end gap-1">
          {bars.map((h, i) => (
            <span key={i} style={{ height: `${h}%`, "--i": i } as React.CSSProperties} className="bar flex-1 rounded-t-sm bg-accent/70" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ImportShot() {
  const phases: [string, number][] = [
    ["Agents and groups", 100],
    ["Customers", 100],
    ["Macros and rules", 100],
    ["Tickets and messages", 64],
  ];
  return (
    <div className="shot" aria-hidden="true">
      <Bar title="Import from Zendesk" />
      <div className="grid gap-2.5 p-3">
        {phases.map(([label, pct]) => (
          <div key={label} className="grid gap-1">
            <span className="flex justify-between text-[12px]">
              <span>{label}</span>
              <span className="num text-muted">{pct === 100 ? "done" : `${pct}%`}</span>
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-line">
              <span className={`meter block h-full rounded-full ${pct === 100 ? "bg-accent" : "bg-accent/60"}`} style={{ width: `${pct}%` }} />
            </span>
          </div>
        ))}
        <p className="text-[11px] text-muted">Every original record is archived, and anything that didn&apos;t map is listed in a report.</p>
      </div>
    </div>
  );
}

export function PriceShot() {
  return (
    <div className="shot num grid gap-1 p-4 text-[12px]" aria-hidden="true">
      <span className="eyebrow mb-1 font-sans">Your invoice</span>
      <span className="flex justify-between"><span>8 agents × {usd(PLAN.seatPrice)}</span><span>{usd(8 * PLAN.seatPrice)}</span></span>
      <span className="flex justify-between text-muted"><span>{8 * PLAN.includedPerAgent} AI resolutions</span><span>included</span></span>
      <span className="flex justify-between text-muted"><span>Overage</span><span>off</span></span>
      <span className="mt-1 flex justify-between border-t border-line pt-1.5 font-medium"><span>Total</span><span>{usd(8 * PLAN.seatPrice)}</span></span>
    </div>
  );
}
