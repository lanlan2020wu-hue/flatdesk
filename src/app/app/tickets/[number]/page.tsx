import { and, asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import AutoSubmitSelect from "@/components/AutoSubmitSelect";
import Avatar from "@/components/Avatar";
import Composer from "@/components/Composer";
import CopilotSummary from "@/components/CopilotSummary";
import SlaBadge from "@/components/SlaBadge";
import { RepeatPrompt } from "@/components/MacroSuggestion";
import { db, schema } from "@/db";
import { attachmentsByMessage, formatBytes } from "@/lib/attachments";
import { requireSession } from "@/lib/auth";
import { RATING_LABEL, ratingsForTicket } from "@/lib/csat";
import { STATUS_STYLE, timeAgo } from "@/lib/format";
import { aiConfigured } from "@/lib/ai";
import { cachedSummary } from "@/lib/copilot";
import { identifyMacro, repeatPrompt } from "@/lib/macro-suggestions";
import { STATUS_LABEL } from "@/lib/receipts";
import { formatDue, shortDuration, slaState, targetLabel } from "@/lib/sla";
import { getTicket, listAgents } from "@/lib/tickets";
import { replyAction, updateTicketAction } from "../../actions";

export async function generateMetadata({ params }: PageProps<"/app/tickets/[number]">) {
  return { title: `#${(await params).number}` };
}

const field = "field field-sm";
const heading = "eyebrow";

export default async function TicketPage({ params }: PageProps<"/app/tickets/[number]">) {
  const s = await requireSession();
  const number = Number((await params).number);
  if (!Number.isInteger(number)) notFound();
  const data = await getTicket(s.orgId, number);
  if (!data) notFound();
  const { ticket, customer, thread } = data;
  // "Imported from" first; Postgres returns jsonb keys in its own order.
  const fieldEntries = Object.entries(ticket.fields).sort(([a], [b]) => Number(b === "Imported from") - Number(a === "Imported from"));
  const customerFields = Object.entries(customer.fields);
  // Right after this agent replies with an answer they keep sending, offer to save it as a macro.
  const last = thread.at(-1);
  const justReplied = last && last.authorType === "agent" && !last.internal && last.authorId === s.userId;
  const [agents, macros, [aiEvent], repeat, files, ratings, org, summary] = await Promise.all([
    listAgents(s.orgId),
    db.select().from(schema.macros).where(and(eq(schema.macros.orgId, s.orgId))).orderBy(asc(schema.macros.name)),
    db
      .select()
      .from(schema.aiEvents)
      .where(and(eq(schema.aiEvents.orgId, s.orgId), eq(schema.aiEvents.ticketId, ticket.id)))
      .orderBy(desc(schema.aiEvents.createdAt))
      .limit(1),
    justReplied ? repeatPrompt(s.orgId, ticket.id, last) : null,
    attachmentsByMessage(s.orgId, thread.map((m) => m.id)),
    ratingsForTicket(s.orgId, ticket.id),
    db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId) }),
    cachedSummary(s.orgId, ticket.id, last?.id),
  ]);
  const copilotOn = aiConfigured();
  // AI macros: when the customer is waiting on us, the macro that answers what they asked.
  const lastVisible = thread.filter((m) => !m.internal && m.authorType !== "system").at(-1);
  const suggestedMacro = ticket.status !== "closed" && lastVisible?.authorType === "customer" ? identifyMacro(lastVisible.body, macros) : null;
  const sla = org ? slaState(ticket, org) : null;
  // The receipt line for this ticket's AI answer, shown under that answer.
  const receipt =
    aiEvent && aiEvent.kind !== "draft"
      ? aiEvent.kind === "refunded"
        ? STATUS_LABEL.refunded
        : aiEvent.kind === "resolution"
          ? STATUS_LABEL[aiEvent.overage ? "overage" : "included"]
          : STATUS_LABEL["customer-replied"]
      : null;

  return (
    <div className="grid gap-8 px-4 py-6 md:px-8 md:py-8 xl:grid-cols-[minmax(0,1fr)_272px]">
      <div className="grid min-w-0 content-start gap-5">
        <header className="grid gap-3 border-b border-line pb-5">
          <Link href="/app/inbox" className="flex w-max items-center gap-1 text-sm text-muted transition-colors hover:text-ink">
            <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
            Inbox
          </Link>
          <h1 className="font-display text-3xl sm:text-4xl">{ticket.subject}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="num">#{ticket.number}</span>
            <span className="chip capitalize">{ticket.channel}</span>
            {ticket.channel === "chat" && (
              <span className="chip" title="Chat visitors type their own email address; nothing checks it belongs to them.">Email not verified</span>
            )}
            <span className={`capitalize ${STATUS_STYLE[ticket.status]}`}>{ticket.status}</span>
            <SlaBadge state={sla} hours={org?.businessHours ?? null} />
            <span>· {customer.name || customer.email}</span>
          </p>
        </header>

        {copilotOn && thread.length > 0 && <CopilotSummary ticketId={ticket.id} initial={summary?.summary ?? null} stale={summary?.stale ?? false} disabled={s.viewer} />}

        <ol className="grid gap-4">
          {thread.map((m, i) => {
            // Imported messages can come from people who aren't the customer or on the team (a CC, a former agent).
            const who =
              m.authorType === "customer"
                ? (m.authorId !== customer.id && m.authorName) || customer.name || customer.email
                : m.authorType === "ai"
                  ? "AI assistant"
                  : m.authorType === "system"
                    ? (m.authorName ?? "Flatdesk")
                    : (m.agentName ?? m.authorName ?? "Agent");
            const tone = m.internal
              ? "border-warn/40 bg-warn-soft"
              : m.authorType === "customer"
                ? "border-line bg-surface"
                : "border-accent/30 bg-accent-soft";
            return (
              <li key={m.id} style={{ "--d": Math.min(i, 6) } as React.CSSProperties} className="enter flex gap-3">
                <Avatar name={who} className="mt-1 size-8 text-[11px]" />
                <div className={`grid min-w-0 flex-1 gap-1.5 rounded-[6px] border px-4 py-3 ${tone}`}>
                  <p className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      {who}
                      {m.internal && m.authorType !== "system" && <span className="pill bg-warn/15 text-warn">Internal note</span>}
                    </span>
                    <time className="text-xs text-muted" dateTime={m.createdAt.toISOString()} title={m.createdAt.toLocaleString("en-US")}>{timeAgo(m.createdAt)}</time>
                  </p>
                  {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                  {files.get(m.id) && (
                    <ul className="flex flex-wrap gap-2 pt-1" aria-label="Attachments">
                      {files.get(m.id)!.map((f) => (
                        <li key={f.id}>
                          <a href={`/app/attachments/${f.id}`} target="_blank" rel="noopener" className="flex max-w-64 items-center gap-2 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm transition-colors hover:border-line-strong">
                            <svg viewBox="0 0 20 20" className="size-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M13.5 6.5 7.8 12.2a1.6 1.6 0 1 0 2.3 2.3l6-6a3.2 3.2 0 0 0-4.5-4.5l-6 6a4.8 4.8 0 0 0 6.8 6.8l5-5" /></svg>
                            <span className="truncate">{f.filename}</span>
                            <span className="num shrink-0 text-xs text-muted">{formatBytes(f.size)}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                  {ratings.get(m.id) && (
                    <p className="grid gap-0.5 border-t border-accent/20 pt-2 text-sm">
                      <span className={ratings.get(m.id)!.rating === "bad" ? "text-warn" : "text-muted"}>Customer rated this reply {RATING_LABEL[ratings.get(m.id)!.rating]}</span>
                      {ratings.get(m.id)!.comment && <span className="whitespace-pre-wrap break-words">&ldquo;{ratings.get(m.id)!.comment}&rdquo;</span>}
                    </p>
                  )}
                  {m.deliveryError && <p className="text-sm text-warn">This reply wasn&apos;t emailed: {m.deliveryError}</p>}
                  {m.authorType === "ai" && receipt && aiEvent && (
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-accent/20 pt-2 text-xs text-muted">
                      <span className="num">Receipt</span>
                      <span>{receipt}</span>
                      {aiEvent.sources.length > 0 && <span>· used {aiEvent.sources.join(", ")}</span>}
                      <Link href={`/app/receipts?month=${aiEvent.month}#e-${aiEvent.id}`} className="link ml-auto">View</Link>
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {repeat && <RepeatPrompt number={ticket.number} prompt={repeat} />}

        {s.viewer ? (
          <p className="card p-4 text-sm text-muted">You have a viewer seat, so you can read this ticket but not reply. An admin can make you an agent in Settings.</p>
        ) : (
        <Composer
          key={thread.length}
          action={replyAction}
          ticketId={ticket.id}
          number={ticket.number}
          status={ticket.status}
          macros={macros.map((m) => ({ id: m.id, name: m.name, body: m.body, addTags: m.addTags, setStatus: m.setStatus, assignTo: m.assignTo, sendNow: m.sendNow }))}
          customerName={customer.name}
          agents={agents.filter((a) => !a.viewer).map((a) => ({ userId: a.userId, name: a.name }))}
          suggestedMacroId={suggestedMacro?.id ?? null}
          copilot={copilotOn}
        />
        )}
      </div>

      <aside className="grid content-start gap-5 self-start border-t border-line pt-5 text-sm xl:sticky xl:top-8 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-6">
        <section className="grid gap-2">
          <h2 className={heading}>Customer</h2>
          <div className="flex items-center gap-3">
            <Avatar name={customer.name || customer.email} className="size-10 text-sm" />
            <div className="min-w-0">
              <p className="truncate font-medium">{customer.name || customer.email}</p>
              {customer.name && <p className="break-all text-muted">{customer.email}</p>}
            </div>
          </div>
          {customerFields.length > 0 && (
            <dl className="grid gap-1.5 pt-1">
              {customerFields.map(([k, v]) => (
                <div key={k} className="grid gap-0.5">
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="break-words">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <fieldset disabled={s.viewer} className="contents">
        <form key={`status-${ticket.status}`} action={updateTicketAction} className="grid gap-1.5 border-t border-line pt-4">
          <input type="hidden" name="ticketId" value={ticket.id} />
          <input type="hidden" name="number" value={ticket.number} />
          <label htmlFor="status" className={heading}>Status</label>
          <AutoSubmitSelect id="status" name="status" defaultValue={ticket.status} className={field}>
            <option value="open">Open</option>
            <option value="pending">Pending</option>
            <option value="closed">Closed</option>
          </AutoSubmitSelect>
        </form>

        <form key={`assignee-${ticket.assigneeId}`} action={updateTicketAction} className="grid gap-1.5">
          <input type="hidden" name="ticketId" value={ticket.id} />
          <input type="hidden" name="number" value={ticket.number} />
          <label htmlFor="assigneeId" className={heading}>Assignee</label>
          <AutoSubmitSelect id="assigneeId" name="assigneeId" defaultValue={ticket.assigneeId ?? ""} className={field}>
            <option value="">Unassigned</option>
            {agents.map((a) => <option key={a.userId} value={a.userId}>{a.userId === s.userId ? `${a.name} (me)` : a.name}</option>)}
          </AutoSubmitSelect>
        </form>

        <form key={`tags-${ticket.tags.join()}`} action={updateTicketAction} className="grid gap-1.5">
          <input type="hidden" name="ticketId" value={ticket.id} />
          <input type="hidden" name="number" value={ticket.number} />
          <label htmlFor="tags" className={heading}>Tags</label>
          <div className="flex gap-2">
            <input id="tags" name="tags" defaultValue={ticket.tags.join(", ")} className={field} />
            <button className="btn btn-secondary btn-sm">Save</button>
          </div>
        </form>
        </fieldset>

        {fieldEntries.length > 0 && (
          <section className="grid gap-2 border-t border-line pt-4">
            <h2 className={heading}>{ticket.source ? "Original fields" : "Fields"}</h2>
            <dl className="grid gap-2">
              {fieldEntries.map(([k, v]) => (
                <div key={k} className="grid gap-0.5">
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="break-words">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <section className="grid gap-1 border-t border-line pt-4 text-muted">
          <p>Opened {timeAgo(ticket.createdAt)}</p>
          {ticket.firstResponseAt && <p>First reply {timeAgo(ticket.firstResponseAt)}</p>}
          {sla && org?.firstResponseMinutes && (
            <p className={sla.kind === "overdue" || sla.kind === "missed" ? "text-warn" : undefined}>
              {sla.kind === "met" && `First reply in ${shortDuration(sla.took)}, within the target of ${targetLabel(org.firstResponseMinutes)}`}
              {sla.kind === "missed" && `First reply in ${shortDuration(sla.took)}, past the target of ${targetLabel(org.firstResponseMinutes)}`}
              {sla.kind === "waiting" && `First reply due ${formatDue(sla.due, org.businessHours)}`}
              {sla.kind === "overdue" && `First reply overdue by ${shortDuration(sla.minutesLate)}`}
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}
