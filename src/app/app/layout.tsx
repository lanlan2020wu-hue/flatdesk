import Link from "next/link";
import AccountMenu from "@/components/AccountMenu";
import AuthProvider from "@/components/AuthProvider";
import Logo from "@/components/Logo";
import MobileNav from "@/components/MobileNav";
import Paywall from "@/components/Paywall";
import NavLink from "@/components/NavLink";
import { aiUsage } from "@/lib/ai";
import { requireSession, teamPlan } from "@/lib/auth";
import { getOnboarding } from "@/lib/onboarding";
import { seatPriceFor, usd } from "@/lib/pricing";
import { VIEWS, viewCounts } from "@/lib/tickets";

export const metadata = { title: { default: "Inbox", template: "%s · Flatdesk" }, description: "Your Flatdesk workspace.", robots: { index: false } };

function SideMeter({ label, used, of }: { label: string; used: number; of: number }) {
  return (
    <span className="grid gap-1.5">
      <span className="flex justify-between gap-2">
        <span>{label}</span>
        <span className="num text-field-muted">
          {used}/{of}
        </span>
      </span>
      <span className="h-1 overflow-hidden rounded-full bg-field-line" aria-hidden="true">
        <span className={`block h-full rounded-full ${used >= of ? "bg-warn" : "bg-lime"}`} style={{ width: `${Math.min(100, (used / Math.max(1, of)) * 100)}%` }} />
      </span>
    </span>
  );
}

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const s = await requireSession();
  const [counts, { org, plan }, onboarding, ai] = await Promise.all([
    viewCounts(s.orgId, s.userId),
    teamPlan(s.orgId),
    s.role === "admin" ? getOnboarding(s.orgId) : null,
    aiUsage(s.orgId),
  ]);
  // teamPlan asks Stripe first when the row looks unpaid (it's stale right after Checkout).

  const interval = org?.billingInterval === "year" ? "year" : "month";
  const seats = org?.billedSeats ?? null;

  return (
    <AuthProvider>
    <div className="grid min-h-screen flex-1 grid-rows-[auto_1fr] md:grid-cols-[236px_minmax(0,1fr)] md:grid-rows-none">
      <div className="bg-field text-field-ink">
        <MobileNav bar={<Logo href="/app/overview" onField />}>
        <aside className="flex w-full flex-col gap-5 px-3 pb-4 text-sm md:sticky md:top-0 md:h-screen md:overflow-y-auto md:py-5">
          <div className="hidden px-2 md:block">
            <Logo href="/app/overview" onField />
          </div>
          <Link href="/app/tickets/new" className="btn btn-on-field btn-sm w-full">
            <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
            New ticket
          </Link>
          {onboarding?.visible && (
            <Link href="/app/welcome" className="grid gap-1.5 rounded-[6px] bg-field-2 px-3 py-2.5 transition-colors hover:bg-field-line">
              <span className="flex justify-between gap-2">
                <span className="font-medium">Finish setup</span>
                <span className="num text-xs text-field-muted">
                  {onboarding.doneCount}/{onboarding.steps.length}
                </span>
              </span>
              <span className="h-1 overflow-hidden rounded-full bg-field-line" aria-hidden="true">
                <span className="block h-full rounded-full bg-lime" style={{ width: `${(onboarding.doneCount / onboarding.steps.length) * 100}%` }} />
              </span>
            </Link>
          )}
          <nav className="grid gap-px" aria-label="Your seat">
            <NavLink href="/app/overview">Overview</NavLink>
            <NavLink href="/app/macros">AI macros</NavLink>
          </nav>
          <nav className="grid gap-px" aria-label="Views">
            <p className="nav-group">Inbox</p>
            {VIEWS.map((v) => (
              <NavLink key={v.id} href={`/app/inbox?view=${v.id}`}>
                <span>{v.label}</span>
                {counts[v.id] !== null && <span className="num text-xs">{counts[v.id]}</span>}
              </NavLink>
            ))}
          </nav>
          <nav className="grid gap-px" aria-label="Tools">
            <p className="nav-group">Tools</p>
            <NavLink href="/app/receipts">AI receipts</NavLink>
            <NavLink href="/app/test-drive">AI test drive</NavLink>
            <NavLink href="/app/help">Help center</NavLink>
            <NavLink href="/app/reports">Reports</NavLink>
          </nav>
          <nav className="grid gap-px" aria-label="Workspace">
            <p className="nav-group">Workspace</p>
            {s.role === "admin" && <NavLink href="/app/import">Import</NavLink>}
            <NavLink href="/app/settings">Settings</NavLink>
          </nav>
          {/* The flat rate stays in view: what a seat costs and what the AI has used this month. */}
          <div className="mt-auto grid gap-3">
            <Link href="/app/overview" className="grid gap-2.5 rounded-[6px] border border-field-line px-3 py-3 text-xs transition-colors hover:border-field-muted">
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">Flat rate</span>
                <span className="num text-field-muted">
                  {seats ? `${seats} × ` : ""}
                  {usd(seatPriceFor(interval))}
                </span>
              </span>
              <SideMeter label="AI answers" used={ai.used} of={ai.included} />
              <span className="text-field-muted">AI macros never use the allowance.</span>
            </Link>
            <div className="rounded-[6px] bg-surface px-2.5 py-2 text-ink">
              <AccountMenu fallbackName={s.name} />
            </div>
          </div>
        </aside>
        </MobileNav>
      </div>
      <div className="min-w-0">
        {plan.state === "trial" && (
          <p className="flex flex-wrap items-center gap-x-2 border-b border-accent/20 bg-accent-soft px-4 py-2.5 text-sm md:px-8">
            {plan.daysLeft === 1 ? "Your free trial ends tomorrow." : `${plan.daysLeft} days left in your free trial.`}{" "}
            {s.role === "admin" ? (
              <Link href="/app/settings#billing" className="link font-medium text-accent">Add a card to keep going</Link>
            ) : (
              "Ask an admin to add a card in Settings."
            )}
          </p>
        )}
        {plan.state === "locked" ? <Paywall isAdmin={s.role === "admin"} /> : children}
      </div>
    </div>
    </AuthProvider>
  );
}
