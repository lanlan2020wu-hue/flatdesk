import { eq } from "drizzle-orm";
import Link from "next/link";
import SlaBadge from "@/components/SlaBadge";
import { db, schema } from "@/db";
import { requireOpenPage } from "@/lib/auth";
import { STATUS_STYLE, timeAgo } from "@/lib/format";
import { slaState } from "@/lib/sla";
import { VIEWS, isView, listTickets } from "@/lib/tickets";

export const metadata = { title: "Inbox" };

export default async function InboxPage({ searchParams }: PageProps<"/app/inbox">) {
  const s = await requireOpenPage();
  const sp = await searchParams;
  const view = isView(sp.view) ? sp.view : "open";
  const [tickets, org] = await Promise.all([listTickets(s.orgId, s.userId, view), db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId) })]);
  const now = new Date();
  const rows = tickets.map((t) => ({ ...t, sla: org ? slaState(t, org, now) : null }));
  const overdue = rows.filter((t) => t.sla?.kind === "overdue").length;
  const label = VIEWS.find((v) => v.id === view)!.label;

  return (
    <div className="grid content-start gap-5 px-4 py-6 md:px-8 md:py-8">
      <header className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h1 className="font-display text-3xl sm:text-4xl">{label}</h1>
          <p className="num text-sm text-muted">
            {rows.length} {rows.length === 1 ? "ticket" : "tickets"}
            {overdue > 0 && <span className="text-warn">, {overdue} past the first-reply target</span>}
          </p>
        </div>
        {/* The views again as tabs, so phones don't need the menu to switch. */}
        <nav aria-label="Views" className="-mx-1 flex gap-1 overflow-x-auto border-b border-line text-sm">
          {VIEWS.map((v) => (
            <Link
              key={v.id}
              href={`/app/inbox?view=${v.id}`}
              aria-current={v.id === view ? "page" : undefined}
              className={`-mb-px whitespace-nowrap border-b-2 px-2 pt-1 pb-2 transition-colors ${v.id === view ? "border-ink font-semibold text-ink" : "border-transparent text-muted hover:text-ink"}`}
            >
              {v.label}
            </Link>
          ))}
        </nav>
      </header>
      {rows.length === 0 ? (
        <div className="grid place-items-center gap-2 rounded-[8px] border border-dashed border-line-strong px-4 py-16 text-center">
          <svg viewBox="0 0 24 24" className="size-10 rounded-full bg-accent-soft p-2.5 text-accent" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 13h4l1.5 2.5h5L16 13h4M5.5 6h13L20 13v5H4v-5z" /></svg>
          <p className="font-medium">No tickets here.</p>
          <p className="text-sm text-muted">New email and chat conversations land in All open.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[8px] border border-line bg-surface">
          <div className="hidden grid-cols-[minmax(0,1fr)_7rem_9rem_8.5rem_4.5rem] gap-4 border-b border-line bg-surface-2/60 px-4 py-2 text-xs font-semibold text-muted lg:grid" aria-hidden="true">
            <span>Ticket</span>
            <span>Status</span>
            <span>Assignee</span>
            <span>First reply</span>
            <span className="text-right">Updated</span>
          </div>
          <ul className="divide-y divide-line">
            {rows.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/app/tickets/${t.number}`}
                  className="group grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 px-4 py-3 transition-colors hover:bg-accent-soft/50 lg:grid-cols-[minmax(0,1fr)_7rem_9rem_8.5rem_4.5rem] lg:items-center"
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
                    <span><span className={`capitalize ${STATUS_STYLE[t.status]}`}>{t.status}</span></span>
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
