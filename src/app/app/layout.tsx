import Link from "next/link";
import AccountMenu from "@/components/AccountMenu";
import Logo from "@/components/Logo";
import NavLink from "@/components/NavLink";
import { requireSession } from "@/lib/auth";
import { getOnboarding } from "@/lib/onboarding";
import { VIEWS, viewCounts } from "@/lib/tickets";

export const metadata = { title: { default: "Inbox", template: "%s · Flatdesk" } };

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const s = await requireSession();
  const [counts, onboarding] = await Promise.all([viewCounts(s.orgId, s.userId), s.role === "admin" ? getOnboarding(s.orgId) : null]);

  return (
    <div className="grid min-h-screen flex-1 md:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-6 border-b border-line bg-surface px-3 py-4 md:sticky md:top-0 md:h-screen md:border-r md:border-b-0 md:py-5">
        <div className="px-2">
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
        <nav className="grid gap-0.5 text-sm" aria-label="Views">
          <p className="eyebrow px-2.5 pb-1.5">Inbox</p>
          {VIEWS.map((v) => (
            <NavLink key={v.id} href={`/app/inbox?view=${v.id}`}>
              <span>{v.label}</span>
              {counts[v.id] !== null && <span className="num text-xs">{counts[v.id]}</span>}
            </NavLink>
          ))}
        </nav>
        <nav className="grid gap-0.5 text-sm" aria-label="Settings">
          <p className="eyebrow px-2.5 pb-1.5">Workspace</p>
          <NavLink href="/app/macros">Macros and rules</NavLink>
          {s.role === "admin" && <NavLink href="/app/import">Import</NavLink>}
          <NavLink href="/app/settings">Settings</NavLink>
        </nav>
        <div className="mt-auto border-t border-line px-2 pt-4">
          <AccountMenu fallbackName={s.name} />
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
