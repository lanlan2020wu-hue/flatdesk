import Link from "next/link";
import { eq } from "drizzle-orm";
import AccountMenu from "@/components/AccountMenu";
import AuthProvider from "@/components/AuthProvider";
import Logo from "@/components/Logo";
import MobileNav from "@/components/MobileNav";
import Paywall from "@/components/Paywall";
import { db, schema } from "@/db";
import NavLink from "@/components/NavLink";
import { requireSession, teamPlan } from "@/lib/auth";
import { getOnboarding } from "@/lib/onboarding";
import { viewCounts } from "@/lib/tickets";

export const metadata = { title: { default: "Inbox", template: "%s · Flatdesk" }, description: "Your Flatdesk workspace.", robots: { index: false } };

// Sidebar line icons: one 24px grid, one stroke weight.
const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const s = await requireSession();
  const [counts, { plan }, onboarding, org] = await Promise.all([
    viewCounts(s.orgId, s.userId),
    teamPlan(s.orgId),
    s.role === "admin" ? getOnboarding(s.orgId) : null,
    db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId), columns: { widgetKey: true } }),
  ]);
  // teamPlan asks Stripe first when the row looks unpaid (it's stale right after Checkout).

  return (
    <AuthProvider>
    <div className="grid min-h-screen flex-1 grid-rows-[auto_1fr] md:grid-cols-[236px_minmax(0,1fr)] md:grid-rows-none">
      <div className="bg-field text-field-ink">
        <MobileNav bar={<Logo href="/app/inbox" onField />}>
        <aside className="flex w-full flex-col gap-4 px-3 pb-4 text-sm md:sticky md:top-0 md:h-screen md:overflow-y-auto md:py-5">
          <div className="hidden px-2 md:block">
            <Logo href="/app/inbox" onField />
          </div>
          {/* Tickets come in the way customers send them: the chat window asks for their email every time, and the AI answers. */}
          <a href={`/chat/${org?.widgetKey}?new`} target="_blank" rel="noreferrer" className="btn btn-on-field btn-sm w-full" title="Opens your chat window, where the customer gives their email">
            <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
            New ticket
          </a>
          {/* Daily work first; the rest sits below as a quieter list. Inbox views are tabs on the inbox page. */}
          <nav className="grid gap-0.5" aria-label="Main">
            <NavLink href="/app/inbox" alsoActive="/app/tickets/">
              <Icon d="M4 13h4l1.5 2.5h5L16 13h4M5.5 6h13L20 13v5H4v-5z" />
              <span>Inbox</span>
              <span className="nav-count">{counts.open}</span>
            </NavLink>
            <NavLink href="/app/overview">
              <Icon d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
              Overview
            </NavLink>
            <NavLink href="/app/receipts">
              <Icon d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 20 12zM9 12h.01M12 12h.01M15 12h.01" />
              AI answers
            </NavLink>
            <NavLink href="/app/macros">
              <Icon d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z" />
              AI macros
            </NavLink>
            <NavLink href="/app/help">
              <Icon d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2zM9 7h7" />
              Help center
            </NavLink>
            <NavLink href="/app/reports">
              <Icon d="M5 20v-8M12 20V5M19 20v-5" />
              Reports
            </NavLink>
          </nav>
          <nav className="grid gap-0.5 border-t border-field-line pt-4 text-[13px]" aria-label="More">
            {onboarding?.visible && (
              <NavLink href="/app/welcome">
                <Icon d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 12l2.5 2.5 4.5-5" />
                <span>Finish setup</span>
                <span className="nav-count">
                  {onboarding.doneCount}/{onboarding.steps.length}
                </span>
              </NavLink>
            )}
            <NavLink href="/app/test-drive">
              <Icon d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM10 8.5v7l5.5-3.5z" />
              AI test drive
            </NavLink>
            {s.role === "admin" && (
              <NavLink href="/app/test-tickets">
                <Icon d="M9 3h6M10 3v6L5 18a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3L14 9V3M7.5 14h9" />
                Test tickets
              </NavLink>
            )}
            {s.role === "admin" && (
              <NavLink href="/app/import">
                <Icon d="M12 3v11M7.5 9.5 12 14l4.5-4.5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
                Import
              </NavLink>
            )}
            <NavLink href="/app/routing">
              <Icon d="M6 4v6a4 4 0 0 0 4 4h8M14 10l4 4-4 4M6 20v-2" />
              Groups and routing
            </NavLink>
            <NavLink href="/app/actions">
              <Icon d="M13 3 5 14h6l-1 7 8-11h-6z" />
              AI actions
            </NavLink>
            <NavLink href="/app/integrations">
              <Icon d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5" />
              Integrations
            </NavLink>
            <NavLink href="/app/settings">
              <Icon d="M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4" />
              Settings
            </NavLink>
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
