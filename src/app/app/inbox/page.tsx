import Link from "next/link";
import Avatar from "@/components/Avatar";
import { requireSession } from "@/lib/auth";
import { STATUS_STYLE, timeAgo } from "@/lib/format";
import { VIEWS, isView, listTickets } from "@/lib/tickets";

export const metadata = { title: "Inbox" };

export default async function InboxPage({ searchParams }: PageProps<"/app/inbox">) {
  const s = await requireSession();
  const sp = await searchParams;
  const view = isView(sp.view) ? sp.view : "open";
  const rows = await listTickets(s.orgId, s.userId, view);
  const label = VIEWS.find((v) => v.id === view)!.label;

  return (
    <div className="grid gap-5 px-4 py-6 md:px-8 md:py-8">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-3xl">{label}</h1>
        <p className="num text-sm text-muted">{rows.length} {rows.length === 1 ? "ticket" : "tickets"}</p>
      </header>
      {rows.length === 0 ? (
        <div className="card grid place-items-center gap-2 border-dashed px-4 py-16 text-center shadow-none">
          <svg viewBox="0 0 24 24" className="size-10 rounded-full bg-accent-soft p-2.5 text-accent" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 13h4l1.5 2.5h5L16 13h4M5.5 6h13L20 13v5H4v-5z" /></svg>
          <p className="font-medium">No tickets here.</p>
        </div>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {rows.map((t) => (
            <li key={t.id}>
              <Link href={`/app/tickets/${t.number}`} className="group grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-3.5 transition-colors hover:bg-surface-2/70 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-x-4">
                <Avatar name={t.customerName || t.customerEmail} className="size-9 text-xs" />
                <div className="min-w-0">
                  <p className="truncate font-medium group-hover:text-accent">
                    <span className="num mr-2 text-sm font-normal text-muted">#{t.number}</span>
                    {t.subject}
                  </p>
                  <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted">
                    <span className="truncate">{t.customerName || t.customerEmail} · {t.channel}</span>
                    {t.tags.map((tag) => <span key={tag} className="chip hidden sm:inline-flex">{tag}</span>)}
                  </p>
                </div>
                <div className="col-start-2 flex flex-wrap items-center gap-3 text-sm text-muted sm:col-start-3">
                  <span className="whitespace-nowrap">{t.assigneeName ?? "Unassigned"}</span>
                  <span className={`capitalize ${STATUS_STYLE[t.status]}`}>{t.status}</span>
                  <span className="num w-16 whitespace-nowrap text-right text-xs">{timeAgo(t.updatedAt)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
