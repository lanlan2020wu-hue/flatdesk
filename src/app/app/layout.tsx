import Link from "next/link";
import AccountMenu from "@/components/AccountMenu";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { billingConfigured, isActive, refreshSubscription, TRIAL_DAYS } from "@/lib/billing";
import { VIEWS, viewCounts } from "@/lib/tickets";

export const metadata = { title: { default: "Inbox", template: "%s · Flatdesk" } };

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const s = await requireSession();
  const [counts, org] = await Promise.all([viewCounts(s.orgId, s.userId), db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId) })]);
  let status = org?.subscriptionStatus;
  // Right after Checkout the row is stale; ask Stripe before showing the banner.
  if (billingConfigured() && !isActive(status) && org?.stripeCustomerId) {
    status = (await refreshSubscription(s.orgId).catch(() => org))?.subscriptionStatus;
  }
  const needsPlan = billingConfigured() && !isActive(status);

  return (
    <div className="grid min-h-screen flex-1 md:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-6 border-b border-line bg-surface px-4 py-5 md:border-r md:border-b-0">
        <Link href="/app/inbox" className="font-display text-xl">Flatdesk</Link>
        <Link href="/app/tickets/new" className="rounded-md bg-accent px-3 py-2 text-center text-sm font-medium text-accent-ink">New ticket</Link>
        <nav className="grid gap-0.5 text-sm" aria-label="Views">
          {VIEWS.map((v) => (
            <Link key={v.id} href={`/app/inbox?view=${v.id}`} className="flex justify-between rounded-md px-2 py-1.5 hover:bg-bg">
              <span>{v.label}</span>
              {counts[v.id] !== null && <span className="num text-muted">{counts[v.id]}</span>}
            </Link>
          ))}
        </nav>
        <nav className="grid gap-0.5 text-sm" aria-label="Settings">
          <Link href="/app/macros" className="rounded-md px-2 py-1.5 hover:bg-bg">Macros and rules</Link>
          <Link href="/app/settings" className="rounded-md px-2 py-1.5 hover:bg-bg">Settings</Link>
        </nav>
        <div className="mt-auto">
          <AccountMenu fallbackName={s.name} />
        </div>
      </aside>
      <div className="min-w-0">
        {needsPlan && (
          <p className="border-b border-line bg-accent-soft px-4 py-2 text-sm md:px-8">
            {s.role === "admin" ? (
              <>
                Your team doesn&apos;t have a plan yet.{" "}
                <Link href="/app/settings" className="underline">Start the {TRIAL_DAYS}-day free trial</Link>
              </>
            ) : (
              "Your team doesn't have a plan yet. Ask an admin to start the free trial in Settings."
            )}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}
