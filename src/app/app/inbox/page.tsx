import { eq } from "drizzle-orm";
import Link from "next/link";
import SlaBadge from "@/components/SlaBadge";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { STATUS_STYLE, timeAgo } from "@/lib/format";
import { slaState } from "@/lib/sla";
import { VIEWS, isView, listTickets, viewCounts } from "@/lib/tickets";

export const metadata = { title: "Inbox" };

export default async function InboxPage({ searchParams }: PageProps<"/app/inbox">) {
  const s = await requireSession();
  const sp = await searchParams;
  const view = isView(sp.view) ? sp.view : "open";
  const [tickets, org, counts] = await Promise.all([
    listTickets(s.orgId, s.userId, view),
    db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId) }),
    viewCounts(s.orgId, s.userId),
  ]);
  const now = new Date();
  const rows = tickets.map((t) => ({ ...t, sla: org ? slaState(t, org, now) : null }));
  const overdue = rows.filter((t) => t.sla?.kind === "overdue").length;
  // Views that hold one status don't need a status on every row.
  const showStatus = view === "mine" || view === "unassigned";
  const cols = showStatus ? "lg:grid-cols-[minmax(0,1fr)_7rem_9rem_8.5rem_4.5rem]" : "lg:grid-cols-[minmax(0,1fr)_9rem_8.5rem_4.5rem]";

  return (
    <div className="grid content-start gap-5 px-4 py-6 md:px-8 md:py-8">
      <header className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h1 className="font-display text-3xl sm:text-4xl">Inbox</h1>
          {overdue > 0 && <p className="num text-sm text-warn">{overdue} past the first-reply target</p>}
        </div>
        <nav aria-label="Views" className="-mx-1 flex gap-1 overflow-x-auto border-b border-line text-sm">
          {VIEWS.map((v) => (
            <Link
              key={v.id}
              href={`/app/inbox?view=${v.id}`}
              aria-current={v.id === view ? "page" : undefined}
              className={`-mb-px flex items-baseline gap-1.5 whitespace-nowrap border-b-2 px-2 pt-1 pb-2 transition-colors ${v.id === view ? "border-ink font-semibold text-ink" : "border-transparent text-muted hover:text-ink"}`}
            >
              {v.label}
              {counts[v.id] !== null && <span className="num text-xs font-normal text-muted">{counts[v.id]}</span>}
            </Link>
          ))}
        </nav>
      </header>
      {rows.length === 0 ? (
        <div className="grid place-items-center gap-1 px-4 py-16 text-center">
          <p className="font-medium">No tickets here.</p>
          <p className="text-sm text-muted">New email and chat conversations land in All open.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[8px] border border-line bg-surface">
          <div className={`hidden gap-4 border-b border-line bg-surface-2/60 px-4 py-2 text-xs font-semibold text-muted lg:grid ${cols}`} aria-hidden="true">
            <span>Ticket</span>
            {showStatus && <span>Status</span>}
            <span>Assignee</span>
            <span>First reply</span>
            <span className="text-right">Updated</span>
          </div>
          <ul className="divide-y divide-line">
            {rows.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/app/tickets/${t.number}`}
                  className={`group grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 px-4 py-3 transition-colors hover:bg-accent-soft/50 lg:items-center ${cols}`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold group-hover:text-accent">{t.subject}</p>
                    <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted">
                      <span className="num shrink-0 text-xs">#{t.number}</span>
                      <span className="truncate">{t.customerName || t.customerEmail}</span>
                      <span className="shrink-0">· {t.channel}</span>
                      {t.tags.map((tag) => <span key={tag} className="chip hidden sm:inline-flex">{tag}</span>)}
                    </p>
                  </div>
                  <span className="num col-start-2 row-start-1 self-start text-right text-xs text-muted lg:hidden">{timeAgo(t.updatedAt)}</span>
                  <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm lg:contents">
                    {showStatus && <span><span className={`capitalize ${STATUS_STYLE[t.status]}`}>{t.status}</span></span>}
                    <span className={`truncate ${t.assigneeName ? "" : "text-muted"}`}>{t.assigneeName ?? "Unassigned"}</span>
                    <span>{t.sla ? <SlaBadge state={t.sla} hours={org?.businessHours ?? null} /> : <span className="hidden text-muted lg:inline">—</span>}</span>
                    <span className="num hidden text-right text-xs text-muted lg:block">{timeAgo(t.updatedAt)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
