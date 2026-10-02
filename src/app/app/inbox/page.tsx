import { eq } from "drizzle-orm";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import SlaBadge from "@/components/SlaBadge";
import { db, schema } from "@/db";
import { aiConfigured } from "@/lib/ai";
import { requireOpenPage } from "@/lib/auth";
import { STATUS_STYLE, timeAgo } from "@/lib/format";
import { slaState } from "@/lib/sla";
import { VIEWS, isView, listTickets, viewCounts } from "@/lib/tickets";

export const metadata = { title: "Inbox" };

export default async function InboxPage({ searchParams }: PageProps<"/app/inbox">) {
  const s = await requireOpenPage();
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
  const cols = showStatus
    ? "lg:grid-cols-[2.25rem_minmax(0,1fr)_6rem_9.5rem_8rem_4.5rem]"
    : "lg:grid-cols-[2.25rem_minmax(0,1fr)_9.5rem_8rem_4.5rem]";

  return (
    <div className="grid content-start gap-5 px-4 py-6 md:px-8 md:py-8">
      <header className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h1 className="page-title">Inbox</h1>
          {overdue > 0 && <p className="text-sm font-medium text-warn">{overdue} past the first-reply target</p>}
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
        <p className="text-sm text-muted">{VIEWS.find((v) => v.id === view)?.hint}</p>
        {/* Say plainly that the AI replies to customers by itself, so nobody wonders where tickets went. */}
        {org?.aiEnabled && aiConfigured() ? (
          <p className="rounded-lg bg-accent-soft px-4 py-3 text-sm">
            <strong className="font-medium">The AI is answering customers on its own.</strong> When a new email or chat comes in, it replies if your facts,
            macros or help articles cover the question. Those tickets move to Pending, marked AI answered. Anything else stays open here for your team, with
            a note saying why.{" "}
            <Link href="/app/settings#ai" className="link text-accent">AI settings</Link>
          </p>
        ) : (
          <p className="rounded-lg bg-surface-2 px-4 py-3 text-sm text-muted">
            The AI isn&apos;t answering customers right now, so every new ticket waits here for your team.{" "}
            {aiConfigured() && <Link href="/app/settings#ai" className="link text-accent">Turn on AI answers</Link>}
          </p>
        )}
      </header>
      {rows.length === 0 ? (
        <div className="grid place-items-center gap-1 px-4 py-16 text-center">
          <p className="font-medium">No tickets here.</p>
          <p className="text-sm text-muted">New email and chat conversations land in All open.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[8px] border border-line bg-surface shadow-sm">
          <div className={`hidden gap-4 border-b border-line px-4 py-2.5 text-xs font-medium text-muted lg:grid ${cols}`} aria-hidden="true">
            <span className="col-span-2">Conversation</span>
            {showStatus && <span>Status</span>}
            <span>Assignee</span>
            <span>First reply</span>
            <span className="text-right">Updated</span>
          </div>
          <ul className="divide-y divide-line">
            {rows.map((t) => {
              const who = t.customerName || t.customerEmail;
              return (
                <li key={t.id}>
                  {/* Mail-client rows: who wrote, then the subject and the latest words. */}
                  <Link
                    href={`/app/tickets/${t.number}`}
                    className={`group grid grid-cols-[2.25rem_minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 px-4 py-3.5 transition-colors hover:bg-surface-2/50 lg:items-center lg:gap-x-4 ${cols}`}
                  >
                    <Avatar name={who} className="row-span-2 size-9 self-start text-xs lg:row-span-1 lg:self-center" />
                    <div className="min-w-0">
                      <p className="flex min-w-0 items-baseline gap-2 text-sm">
                        <span className="truncate font-semibold">{who}</span>
                        <span className="num shrink-0 text-xs text-muted">#{t.number}</span>
                        {t.test && <span className="chip shrink-0 border-warn/40 bg-warn-soft text-warn" title="Made from Test tickets. Left out of reports and the AI allowance.">Test</span>}
                        {t.resolvedByAi && <span className="chip shrink-0 border-accent/30 bg-accent-soft text-accent" title="The AI replied to this customer on its own.">AI answered</span>}
                        {t.tags.map((tag) => <span key={tag} className="chip hidden shrink-0 sm:inline-flex">{tag}</span>)}
                      </p>
                      {/* A div, not a p: the global p rule's text-wrap would undo truncate. */}
                      <div className="truncate text-sm">
                        <span className="font-medium group-hover:text-accent">{t.subject}</span>
                        {t.preview && t.preview !== t.subject && <span className="text-muted"> · {t.preview.replace(/\s+/g, " ")}</span>}
                      </div>
                    </div>
                    <span className="num col-start-3 row-start-1 self-start text-right text-xs text-muted lg:hidden">{timeAgo(t.updatedAt)}</span>
                    <div className="col-span-2 col-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm lg:contents">
                      {showStatus && <span><span className={`capitalize ${STATUS_STYLE[t.status]}`}>{t.status}</span></span>}
                      <span className={`flex min-w-0 items-center gap-2 ${t.assigneeName ? "" : "text-muted"}`}>
                        {t.assigneeName && <Avatar name={t.assigneeName} className="size-5 text-[9px]" />}
                        <span className="truncate">{t.assigneeName ?? "Unassigned"}</span>
                      </span>
                      <span>{t.sla ? <SlaBadge state={t.sla} hours={org?.businessHours ?? null} /> : <span className="hidden text-muted lg:inline">—</span>}</span>
                      <span className="num hidden text-right text-xs text-muted lg:block">{timeAgo(t.updatedAt)}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
