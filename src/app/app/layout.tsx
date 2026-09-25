import Link from "next/link";
import AccountMenu from "@/components/AccountMenu";
import { requireSession } from "@/lib/auth";
import { VIEWS, viewCounts } from "@/lib/tickets";

export const metadata = { title: { default: "Inbox", template: "%s · Flatdesk" } };

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const s = await requireSession();
  const counts = await viewCounts(s.orgId, s.userId);

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
        </nav>
        <div className="mt-auto">
          <AccountMenu fallbackName={s.name} />
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
