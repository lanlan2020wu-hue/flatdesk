import Link from "next/link";
import AccountMenu from "@/components/AccountMenu";
import AuthProvider from "@/components/AuthProvider";
import { eq } from "drizzle-orm";
import Logo from "@/components/Logo";
import MobileNav from "@/components/MobileNav";
import Paywall from "@/components/Paywall";
import NavLink from "@/components/NavLink";
import { db, schema } from "@/db";
import { aiUsage } from "@/lib/ai";
import { requireSession } from "@/lib/auth";
import { access, billingConfigured, isActive, refreshSubscription } from "@/lib/billing";
import { copilotUsage } from "@/lib/copilot";
import { getOnboarding } from "@/lib/onboarding";
import { seatPriceFor, usd } from "@/lib/pricing";
import { VIEWS, viewCounts } from "@/lib/tickets";

export const metadata = { title: { default: "Inbox", template: "%s · Flatdesk" }, robots: { index: false } };

function SideMeter({ label, used, of }: { label: string; used: number; of: number }) {
  return (
    <span className="grid gap-1">
      <span className="flex justify-between gap-2">
        <span>{label}</span>
        <span className="num text-muted">
          {used}/{of}
        </span>
      </span>
      <span className="h-1 overflow-hidden rounded-full bg-line" aria-hidden="true">
        <span className={`block h-full rounded-full ${used >= of ? "bg-warn" : "bg-accent"}`} style={{ width: `${Math.min(100, (used / Math.max(1, of)) * 100)}%` }} />
      </span>
    </span>
  );
}

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const s = await requireSession();
  const [counts, org, onboarding, ai, copilot] = await Promise.all([
    viewCounts(s.orgId, s.userId),
    db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId) }),
    s.role === "admin" ? getOnboarding(s.orgId) : null,
    aiUsage(s.orgId),
    copilotUsage(s.orgId),
  ]);
  let current = org;
  // Right after Checkout the row is stale; ask Stripe before showing the banner.
  if (org && billingConfigured() && !isActive(org.subscriptionStatus) && org.stripeCustomerId) {
    current = await refreshSubscription(s.orgId).catch(() => org);
  }
  const plan = current ? access(current) : ({ state: "open" } as const);

  return (
    <AuthProvider>
    <div className="grid min-h-screen flex-1 md:grid-cols-[248px_minmax(0,1fr)]">
      <div className="border-b border-line bg-surface md:border-r md:border-b-0">
        <MobileNav bar={<Logo href="/app/inbox" />}>
        <aside className="flex w-full flex-col gap-6 px-3 pb-4 md:sticky md:top-0 md:h-screen md:overflow-y-auto md:py-5">
          <div className="hidden px-2 md:block">
            <Logo href="/app/inbox" />
          </div>
          <Link href="/app/tickets/new" className="btn btn-primary w-full">
            <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
            New ticket
          </Link>
          {onboarding?.visible && (
            <Link href="/app/welcome" className="grid gap-1.5 rounded-lg border border-line bg-bg px-3 py-2.5 text-sm transition-colors hover:border-line-strong">
              <span className="flex justify-between gap-2">
                <span className="font-medium">Finish setup</span>
                <span className="num text-xs text-muted">
                  {onboarding.doneCount}/{onboarding.steps.length}
                </span>
              </span>
              <span className="h-1 overflow-hidden rounded-full bg-line" aria-hidden="true">
                <span className="block h-full rounded-full bg-accent" style={{ width: `${(onboarding.doneCount / onboarding.steps.length) * 100}%` }} />
              </span>
            </Link>
          )}
          <nav className="grid gap-0.5 text-sm" aria-label="Overview">
            <NavLink href="/app/overview">Overview</NavLink>
          </nav>
          <nav className="grid gap-0.5 text-sm" aria-label="Views">
            <p className="eyebrow px-2.5 pb-1.5">Inbox</p>
            {VIEWS.map((v) => (
              <NavLink key={v.id} href={`/app/inbox?view=${v.id}`}>
                <span>{v.label}</span>
                {counts[v.id] !== null && <span className="num text-xs">{counts[v.id]}</span>}
              </NavLink>
            ))}
          </nav>
          <nav className="grid gap-0.5 text-sm" aria-label="AI">
            <p className="eyebrow px-2.5 pb-1.5">AI, included</p>
            <NavLink href="/app/macros">AI macros</NavLink>
            <NavLink href="/app/receipts">AI receipts</NavLink>
            <NavLink href="/app/test-drive">AI test drive</NavLink>
          </nav>
          <nav className="grid gap-0.5 text-sm" aria-label="Settings">
            <p className="eyebrow px-2.5 pb-1.5">Workspace</p>
            <NavLink href="/app/reports">Reports</NavLink>
            <NavLink href="/app/help">Help center</NavLink>
            {s.role === "admin" && <NavLink href="/app/import">Import</NavLink>}
            <NavLink href="/app/settings">Settings</NavLink>
          </nav>
          <Link href="/app/overview" className="mt-auto grid gap-2.5 rounded-xl border border-accent/25 bg-accent-soft/60 px-3 py-3 text-xs transition-colors hover:border-accent/50">
            <span className="flex items-baseline justify-between gap-2">
              <span className="font-medium text-accent">Flat rate</span>
              <span className="num text-muted">{usd(seatPriceFor(org?.billingInterval === "year" ? "year" : "month"))} per seat</span>
            </span>
            <SideMeter label="AI resolutions" used={ai.used} of={ai.included} />
            <SideMeter label="Copilot" used={copilot.used} of={copilot.limit} />
            <span className="text-muted">AI macros and the copilot never use resolutions.</span>
          </Link>
          <div className="border-t border-line px-2 pt-4">
            <AccountMenu fallbackName={s.name} />
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
