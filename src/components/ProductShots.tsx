// Small, static drawings of Flatdesk's own screens for the feature tour.
// The data in them is made up; the layouts match the real app.

import { PLAN, usd } from "@/lib/pricing";

export function FeatureIcon({ d, className = "size-9 p-2 bg-accent-soft" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`draw ${className} shrink-0 rounded-lg text-accent`} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} pathLength={1} />
    </svg>
  );
}

function Bar({ title }: { title: string }) {
  return (
    <div className="shot-bar">
      <span className="text-xs text-muted">{title}</span>
    </div>
  );
}

const at = (ms: number) => ({ "--at": `${ms}ms` }) as React.CSSProperties;

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
          {rows.map(([n, subject, who, ch, owner], i) => (
            <li key={n} style={{ "--i": rows.length - 1 - i } as React.CSSProperties} className="ticket grid gap-0.5 px-3 py-2">
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

const MACRO_WORDS = "Hi [customer name], refunds go back to the original card within 5 business days…".split(" ");

export function MacroShot() {
  return (
    <div className="shot" aria-hidden="true">
      <Bar title="AI macros" />
      <div className="grid gap-3 p-3">
        <div className="grid gap-2 rounded-lg border border-accent/30 bg-accent-soft/70 p-2.5">
          <span className="flex items-center gap-1.5 text-[12px] font-medium text-accent">
            <svg viewBox="0 0 24 24" className="sparkle size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
            </svg>
            AI macro, identified from your replies
          </span>
          <span className="grid gap-1 rounded-md bg-surface p-2 shadow-sm">
            <span className="flex items-center justify-between gap-2">
              <span className="font-medium">Refund timing</span>
              <span className="num text-[11px] text-muted">sent on 12 tickets this week</span>
            </span>
            <span className="text-[11px]">Customers ask: when will my refund reach my card?</span>
            <span className="text-[12px] text-muted">
              {MACRO_WORDS.map((w, i) => (
                <span key={i} style={{ "--w": i } as React.CSSProperties} className="word">{w} </span>
              ))}
            </span>
          </span>
          <span className="flex items-center gap-2">
            <span style={{ "--words": MACRO_WORDS.length } as React.CSSProperties} className="save rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-accent-ink">Save as macro</span>
            <span className="text-[11px] text-muted">Don&apos;t suggest this again</span>
          </span>
        </div>
        <div className="grid gap-1.5 rounded-lg border border-line p-2.5">
          <span className="flex items-center justify-between">
            <span className="font-medium">Password reset</span>
            <span className="flex gap-1">
              <span className="chip">+ account</span>
              <span className="chip">→ pending</span>
            </span>
          </span>
          <span className="text-[12px] text-muted">Hi there, reset links last 30 minutes. Request a new one from the sign-in page…</span>
        </div>
      </div>
    </div>
  );
}

// Evolving macros: the edit the team keeps making, struck through
// and rewritten, with the one-click update.
export function MacroUpdateShot() {
  return (
    <div className="shot" aria-hidden="true">
      <Bar title="AI macros · Refund timing" />
      <div className="grid gap-3 p-3">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-accent">
          <svg viewBox="0 0 24 24" className="sparkle size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
          </svg>
          Your team keeps editing this macro
        </span>
        <div className="grid gap-2 rounded-lg border border-line p-2.5 text-[12px]">
          <span style={{ "--i": 0 } as React.CSSProperties} className="ln flex gap-2">
            <span className="num w-20 shrink-0 whitespace-nowrap text-[11px] text-accent">Reworded 4×</span>
            <span className="grid">
              <span className="text-muted line-through">Refunds reach your card within 5 business days.</span>
              <span>Refunds reach your card within 7 business days.</span>
            </span>
          </span>
          <span style={{ "--i": 1 } as React.CSSProperties} className="ln flex gap-2">
            <span className="num w-20 shrink-0 whitespace-nowrap text-[11px] text-accent">Added 4×</span>
            <span>Your bank may take 2 more days to show it.</span>
          </span>
          <span style={{ "--i": 2 } as React.CSSProperties} className="ln flex gap-2">
            <span className="num w-20 shrink-0 whitespace-nowrap text-[11px] text-warn">Deleted 5×</span>
            <span className="text-muted line-through">Refunds over $500 need a manager.</span>
          </span>
        </div>
        <span className="flex items-center gap-2 text-[11px]">
          <span className="save rounded-md bg-accent px-2 py-1 font-medium text-accent-ink">Update macro</span>
          <span className="text-muted">Keep it as is</span>
          <span className="num ml-auto text-muted">5 sends since it last changed</span>
        </span>
      </div>
    </div>
  );
}

export function TestDriveShot() {
  return (
    <div className="shot" aria-hidden="true">
      <Bar title="AI test drive" />
      <div className="grid gap-3 p-3">
        <span className="flex items-center justify-between gap-2 text-[12px]">
          <span className="font-medium">#4127 Can I change my billing date?</span>
          <span className="num text-muted">12 of 50</span>
        </span>
        <div className="grid grid-cols-2 gap-2">
          <span className="grid content-start gap-1 rounded-lg border border-accent/30 bg-accent-soft/60 p-2">
            <span className="eyebrow text-accent">AI draft</span>
            <span className="text-[12px] text-muted">Yes. In Settings, Billing, pick a new date. The next invoice is prorated to it…</span>
          </span>
          <span className="grid content-start gap-1 rounded-lg border border-line p-2">
            <span className="eyebrow">Your team sent</span>
            <span className="text-[12px] text-muted">Hi Sam, you can move it under Settings, Billing. We prorate the first invoice…</span>
          </span>
        </div>
        <span className="flex items-center gap-2 text-[11px]">
          <span className="rounded-md bg-accent px-2 py-1 font-medium text-accent-ink">Would send</span>
          <span className="rounded-md border border-line px-2 py-1 text-muted">Needs edits</span>
          <span className="rounded-md border border-line px-2 py-1 text-muted">Wrong</span>
          <span className="num ml-auto text-muted">31 would send</span>
        </span>
      </div>
    </div>
  );
}

export function AiShot() {
  return (
    <div className="shot" aria-hidden="true">
      <Bar title="#1042 · Can't reset my password" />
      <div className="grid gap-2.5 p-3">
        <p style={at(0)} className="say rounded-xl rounded-tl-sm border border-line bg-surface px-3 py-2">The reset link says it expired. Can you help?</p>
        <div className="relative">
          <span className="typing absolute top-0 left-0 flex gap-1 rounded-xl rounded-tl-sm border border-accent/30 bg-accent-soft px-3 py-2.5">
            {[0, 1, 2].map((j) => (
              <i key={j} style={{ "--j": j } as React.CSSProperties} className="size-1.5 rounded-full bg-accent/70" />
            ))}
          </span>
          <p style={at(1400)} className="say rounded-xl rounded-tl-sm border border-accent/30 bg-accent-soft px-3 py-2">
            Hi Ana, reset links last 30 minutes. Request a new one from the sign-in page and use it right away…
            <span style={at(1800)} className="ln mt-1.5 flex items-center gap-1.5 border-t border-accent/20 pt-1.5 text-[11px] text-muted">
              Receipt · Counted, included · used <span className="chip">Password reset</span>
            </span>
          </p>
        </div>
        <div className="grid gap-1 pt-1">
          <span className="flex justify-between text-[11px] text-muted">
            <span>AI allowance this month</span>
            <span className="num">612 / 1,000</span>
          </span>
          <span className="h-1.5 overflow-hidden rounded-full bg-line">
            <span style={at(2100)} className="meter block h-full w-[61%] rounded-full bg-accent" />
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
    ["#1035", "Change billing email", "Refunded", "pill strike bg-surface-2 text-muted"],
  ];
  return (
    <div className="shot" aria-hidden="true">
      <Bar title="AI receipts · September 2026" />
      <ol className="divide-y divide-line">
        {lines.map(([n, subject, status, tone], i) => (
          <li key={n} style={{ "--i": i } as React.CSSProperties} className="ln grid gap-1 px-3 py-2.5">
            <span className="flex items-center justify-between gap-2">
              <span className="truncate">
                <span className="num text-muted">{n}</span> <span className="font-medium">{subject}</span>
              </span>
              <span className={`${tone} shrink-0 text-[11px]`}>{status}</span>
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
      <div style={{ "--i": lines.length } as React.CSSProperties} className="ln num flex justify-between border-t border-dashed border-line-strong bg-surface-2 px-3 py-2 text-[12px]">
        <span>AI charges this month</span>
        <span className="font-medium">{usd(0, true)}</span>
      </div>
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
              <span className="text-[11px] text-muted">{l}</span>
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
        {phases.map(([label, pct], i) => (
          <div key={label} style={{ "--i": i } as React.CSSProperties} className="grid gap-1">
            <span className="flex justify-between text-[12px]">
              <span>{label}</span>
              <span className="phase-done num text-muted">{pct === 100 ? "done" : `${pct}%`}</span>
            </span>
            <span className={`h-1.5 overflow-hidden rounded-full bg-line ${pct < 100 ? "running" : ""}`}>
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
