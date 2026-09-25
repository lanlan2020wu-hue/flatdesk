import Link from "next/link";
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
    <div className="grid gap-4 px-4 py-6 md:px-8">
      <h1 className="font-display text-2xl">{label}</h1>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-muted">No tickets here.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {rows.map((t) => (
            <li key={t.id}>
              <Link href={`/app/tickets/${t.number}`} className="grid gap-1 px-4 py-3 hover:bg-bg sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    <span className="num mr-2 text-sm text-muted">#{t.number}</span>
                    {t.subject}
                  </p>
                  <p className="truncate text-sm text-muted">
                    {t.customerName || t.customerEmail} · {t.channel}
                    {t.tags.length > 0 && <> · {t.tags.join(", ")}</>}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-sm text-muted">
                  <span>{t.assigneeName ?? "Unassigned"}</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs capitalize ${STATUS_STYLE[t.status]}`}>{t.status}</span>
                  <span className="num w-20 whitespace-nowrap text-right">{timeAgo(t.updatedAt)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
