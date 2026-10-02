import Link from "next/link";
import AccountMenu from "@/components/AccountMenu";
import AuthProvider from "@/components/AuthProvider";
import { eq } from "drizzle-orm";
import Logo from "@/components/Logo";
import MobileNav from "@/components/MobileNav";
import Paywall from "@/components/Paywall";
import NavLink from "@/components/NavLink";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { access, billingConfigured, isActive, refreshSubscription } from "@/lib/billing";
import { getOnboarding } from "@/lib/onboarding";
import { viewCounts } from "@/lib/tickets";

export const metadata = { title: { default: "Inbox", template: "%s · Flatdesk" }, description: "Your Flatdesk workspace.", robots: { index: false } };

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const s = await requireSession();
  const [counts, org, onboarding] = await Promise.all([
    viewCounts(s.orgId, s.userId),
    db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId) }),
    s.role === "admin" ? getOnboarding(s.orgId) : null,
  ]);
  let current = org;
  // Right after Checkout the row is stale; ask Stripe before showing the banner.
  if (org && billingConfigured() && !isActive(org.subscriptionStatus) && org.stripeCustomerId) {
    current = await refreshSubscription(s.orgId).catch(() => org);
  }
  const plan = current ? access(current) : ({ state: "open" } as const);

  return (
    <AuthProvider>
    <div className="grid min-h-screen flex-1 grid-rows-[auto_1fr] md:grid-cols-[236px_minmax(0,1fr)] md:grid-rows-none">
      <div className="bg-field text-field-ink">
        <MobileNav bar={<Logo href="/app/inbox" onField />}>
        <aside className="flex w-full flex-col gap-5 px-3 pb-4 text-sm md:sticky md:top-0 md:h-screen md:overflow-y-auto md:py-5">
          <div className="hidden px-2 md:block">
            <Logo href="/app/inbox" onField />
          </div>
          <Link href="/app/tickets/new" className="btn btn-on-field btn-sm w-full">
            <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
            New ticket
          </Link>
          {/* Daily work first; the rest sits below as a quieter list. Inbox views are tabs on the inbox page. */}
          <nav className="grid gap-px" aria-label="Main">
            <NavLink href="/app/inbox" alsoActive="/app/tickets/">
              <span>Inbox</span>
              <span className="num text-xs">{counts.open}</span>
            </NavLink>
            <NavLink href="/app/overview">Overview</NavLink>
            <NavLink href="/app/macros">AI macros</NavLink>
            <NavLink href="/app/help">Help center</NavLink>
            <NavLink href="/app/reports">Reports</NavLink>
          </nav>
          <nav className="grid gap-px text-[13px]" aria-label="More">
            {onboarding?.visible && (
              <NavLink href="/app/welcome">
                <span>Finish setup</span>
                <span className="num text-xs">
                  {onboarding.doneCount}/{onboarding.steps.length}
                </span>
              </NavLink>
            )}
            <NavLink href="/app/receipts">AI receipts</NavLink>
            <NavLink href="/app/test-drive">AI test drive</NavLink>
            {s.role === "admin" && <NavLink href="/app/import">Import</NavLink>}
            <NavLink href="/app/settings">Settings</NavLink>
          </nav>
          <div className="mt-auto rounded-[6px] bg-surface px-2.5 py-2 text-ink">
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
