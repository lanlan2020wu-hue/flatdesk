import { and, asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import ActionPanel from "@/components/ActionPanel";
import AutoSubmitSelect from "@/components/AutoSubmitSelect";
import Avatar from "@/components/Avatar";
import Composer from "@/components/Composer";
import CopilotSummary from "@/components/CopilotSummary";
import { followersOf } from "@/lib/followers";
import { CustomerProfile } from "@/components/CustomerProfile";
import { CompanyPanel, HubSpotPanel, JiraPanel, OtherTickets, RelatedArticles, ShopifyOrders, StripeCustomer } from "@/components/CustomerContext";
import LocalTime from "@/components/LocalTime";
import SlaBadge from "@/components/SlaBadge";
import SnoozeMenu from "@/components/SnoozeMenu";
import TagInput from "@/components/TagInput";
import TeachAi from "@/components/TeachAi";
import ScheduledReplies from "@/components/ScheduledReplies";
import TicketPresence from "@/components/TicketPresence";
import { RepeatPrompt } from "@/components/MacroSuggestion";
import { db, schema } from "@/db";
import { attachmentsByMessage, formatBytes } from "@/lib/attachments";
import { requireOpenPage } from "@/lib/auth";
import { RATING_LABEL, ratingsForTicket } from "@/lib/csat";
import { timeAgo } from "@/lib/format";
import { aiConfigured } from "@/lib/ai";
import { ticketRuns } from "@/lib/ai-actions";
import { cachedSummary } from "@/lib/copilot";
import { identifyMacro, repeatPrompt } from "@/lib/macro-suggestions";
import { STATUS_LABEL } from "@/lib/receipts";
import { waitingOn } from "@/lib/scheduled-replies";
import { sidesFor } from "@/lib/side-conversations";
import SideConversations from "@/components/SideConversations";
import { teachSpot } from "@/lib/teach";
import { formatDue, nextReplyState, resolveState, shortDuration, slaState, targetLabel } from "@/lib/sla";
import { listGroups } from "@/lib/routing";
import { guessLanguage, isForeign, languageLabel } from "@/lib/language";
import AutoTranslate from "@/components/AutoTranslate";
import { getTicket, listAgents, orgTags, parseTicketNumber, PRIORITIES } from "@/lib/tickets";
import { TRASH_DAYS } from "@/lib/trash";
import { CHECKED, listFields } from "@/lib/ticket-fields";
import { eraseCustomerAction, followTicketAction, mergeCustomersAction, mergeTicketAction, splitTicketAction, replyAction, saveCcAction, saveTicketFieldsAction, ticketSnoozeAction, ticketTrashAction, updateTicketAction } from "../../actions";

export async function generateMetadata({ params }: PageProps<"/app/tickets/[number]">) {
  return { title: `#${(await params).number}` };
}

const field = "field field-sm";
const heading = "eyebrow";

export default async function TicketPage({ params, searchParams }: PageProps<"/app/tickets/[number]">) {
  const s = await requireOpenPage();
  const number = parseTicketNumber((await params).number);
  if (!number) notFound();
  const data = await getTicket(s.orgId, number);
  if (!data) notFound();
  const { ticket, customer, thread } = data;
  // The team's own fields are edited in the rail; any other values (kept from
  // an import, or a field since deleted) are listed under them, read only.
  const [defined, groups, mergedInto] = await Promise.all([
    listFields(s.orgId),
    listGroups(s.orgId),
    ticket.mergedIntoId ? db.query.tickets.findFirst({ where: and(eq(schema.tickets.orgId, s.orgId), eq(schema.tickets.id, ticket.mergedIntoId)), columns: { number: true } }) : null,
  ]);
  const definedNames = new Set(defined.map((f) => f.name));
  // "Imported from" first; Postgres returns jsonb keys in its own order.
  const fieldEntries = Object.entries(ticket.fields)
    .filter(([k]) => !definedNames.has(k))
    .sort(([a], [b]) => Number(b === "Imported from") - Number(a === "Imported from"));
  const customerFields = Object.entries(customer.fields);
  // Right after this agent replies with an answer they keep sending, offer to save it as a macro.
  const last = thread.at(-1);
  const justReplied = last && last.authorType === "agent" && !last.internal && last.authorId === s.userId;
  const sp = await searchParams;
  const actionMessage = typeof sp.action === "string" ? sp.action.slice(0, 300) : null;
  const mergeError = typeof sp.merge === "string" ? sp.merge.slice(0, 200) : null;
  const eraseMismatch = sp.erase === "mismatch";
  const splitError = typeof sp.split === "string" ? sp.split.slice(0, 200) : null;
  const customersError = typeof sp.customers === "string" ? sp.customers.slice(0, 200) : null;
  const ccError = typeof sp.cc === "string" ? sp.cc.slice(0, 200) : null;
  const customerError = typeof sp.customer === "string" ? sp.customer.slice(0, 200) : null;
  const sideError = typeof sp.side === "string" ? sp.side.slice(0, 200) : null;
  const fieldsNotice = typeof sp.fields === "string" ? sp.fields.slice(0, 300) : null;
  const following = await followersOf(s.orgId, ticket.id);
  const [agents, macros, [aiEvent], repeat, files, ratings, org, summary, tagList, runs, waiting, sides] = await Promise.all([
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
    orgTags(s.orgId),
    ticketRuns(s.orgId, ticket.id),
    waitingOn(s.orgId, ticket.id),
    sidesFor(s.orgId, ticket.id),
  ]);
  const sideById = new Map(sides.map((x) => [x.id, x]));
  const copilotOn = aiConfigured() && Boolean(org?.aiProcessing);
  // The customer's language, from their latest message that says clearly, when it isn't the team's.
  const team = org?.language ?? "en";
  const customerLanguage = [...thread].reverse().filter((m) => m.authorType === "customer").map((m) => guessLanguage(m.body)).find(Boolean) ?? null;
  const foreignCustomer = customerLanguage && customerLanguage !== team ? customerLanguage : null;
  const needsTranslation = copilotOn && !s.viewer && thread.some((m) => m.authorType === "customer" && !m.translation && isForeign(m.body, team));
  // AI macros: when the customer is waiting on us, the macro that answers what they asked.
  const lastVisible = thread.filter((m) => !m.internal && m.authorType !== "system").at(-1);
  const suggestedMacro = ticket.status !== "closed" && lastVisible?.authorType === "customer" ? identifyMacro(lastVisible.body, macros) : null;
  const sla = org ? slaState(ticket, org) : null;
  const resolution = org ? resolveState(ticket, org) : null;
  const nextReply = org ? nextReplyState(ticket, org) : null;
  // Under the AI's latest handoff note, a box to write the answer it was missing.
  const teachAt = s.viewer ? -1 : teachSpot(thread);
  // Any customer message after the first can become a ticket of its own.
  const firstCustomerId = thread.find((m) => m.authorType === "customer" && !m.internal && !m.sideId)?.id;
  const canSplit = (m: (typeof thread)[number]) =>
    !s.viewer && !ticket.deletedAt && !ticket.mergedIntoId && m.authorType === "customer" && !m.internal && !m.sideId && m.id !== firstCustomerId;
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
          <h1 className="page-title">{ticket.subject}</h1>
          {/* Status, assignee and the customer live in the rail; the header only says what the rail doesn't. */}
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="num">#{ticket.number}</span>
            <span className="capitalize">· {ticket.channel}</span>
            {ticket.test && (
              <Link href="/app/test-tickets" className="chip border-warn/40 bg-warn-soft text-warn" title="Left out of reports and the AI allowance.">Test ticket</Link>
            )}
            {ticket.channel === "chat" && (
              <span className="chip" title="Chat visitors type their own email address; nothing checks it belongs to them.">Email not verified</span>
            )}
            <SlaBadge state={sla} hours={org?.businessHours ?? null} />
            <SlaBadge state={nextReply} hours={org?.businessHours ?? null} target="next" />
            <SlaBadge state={resolution} hours={org?.businessHours ?? null} target="resolve" />
          </p>
        </header>

        {ticket.deletedAt && (
          <form action={ticketTrashAction} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warn/40 bg-warn-soft px-4 py-3 text-sm">
            <input type="hidden" name="ticketId" value={ticket.id} />
            <input type="hidden" name="number" value={ticket.number} />
            <p>
              <strong className="font-medium">In the trash.</strong> Moved there {timeAgo(ticket.deletedAt)}; deleted for good on{" "}
              {new Date(ticket.deletedAt.getTime() + TRASH_DAYS * 86_400_000).toLocaleDateString("en-US", { month: "long", day: "numeric" })} unless you restore it.
            </p>
            {!s.viewer && <button name="op" value="restore" className="btn btn-secondary btn-sm">Restore</button>}
          </form>
        )}

        {ticket.snoozedUntil && ticket.snoozedUntil > new Date() && !ticket.deletedAt && ticket.status !== "closed" && (
          <form action={ticketSnoozeAction} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
            <input type="hidden" name="ticketId" value={ticket.id} />
            <input type="hidden" name="number" value={ticket.number} />
            <p>
              <strong className="font-medium">Snoozed</strong>
              {ticket.snoozedBy ? ` by ${ticket.snoozedBy}` : ""} until <LocalTime at={ticket.snoozedUntil.toISOString()} />. It comes back to Open then, or sooner if the customer writes.
            </p>
            {!s.viewer && <button name="op" value="wake" className="btn btn-secondary btn-sm">Wake now</button>}
          </form>
        )}

        {mergedInto && (
          <p role="status" className="rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-sm">
            This ticket was merged into{" "}
            <Link href={`/app/tickets/${mergedInto.number}`} className="link font-medium text-accent">#{mergedInto.number}</Link>. Its messages and any new replies are there.
          </p>
        )}

        <TicketPresence ticketId={ticket.id} latestMessageId={thread.at(-1)?.id ?? null} />

        <ActionPanel runs={runs} number={ticket.number} canDecide={!s.viewer} message={actionMessage} />

        {needsTranslation && <AutoTranslate ticketId={ticket.id} label={languageLabel(team)} />}
        {copilotOn && thread.length > 0 && <CopilotSummary ticketId={ticket.id} initial={summary?.summary ?? null} stale={summary?.stale ?? false} disabled={s.viewer} />}

        {splitError && <p role="alert" className="text-sm text-warn">{splitError}</p>}
        <ol className="grid gap-4">
          {thread.map((m, i) => {
            // Imported messages can come from people who aren't the customer or on the team (a CC, a former agent).
            const who =
              m.authorType === "customer"
                ? (m.authorId !== customer.id && m.authorName) || customer.name || customer.email
                : m.authorType === "ai"
                  ? "AI, sent on its own"
                  : m.authorType === "system"
                    ? (m.authorName ?? "Flatdesk")
                    : (m.agentName ?? m.authorName ?? "Agent");
            // One card per message; the team's side is marked by an accent edge, notes by the warn tint.
            const tone = m.internal
              ? "border-warn/40 bg-warn-soft"
              : m.authorType === "customer"
                ? "border-line bg-surface"
                : "border-line border-l-[3px] border-l-accent bg-surface";
            return (
              <li key={m.id} style={{ "--d": Math.min(i, 6) } as React.CSSProperties} className="enter">
                <div className={`grid min-w-0 gap-2 rounded-[8px] border px-5 py-4 shadow-sm ${tone}`}>
                  <p className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2.5 font-semibold">
                      <Avatar name={who} className="size-7 text-[10px]" />
                      {who}
                      {m.sideId ? (
                        <span className="pill bg-surface-2 font-normal text-muted">
                          {m.authorType === "system" ? "Answer" : `To ${sideById.get(m.sideId)?.toName || sideById.get(m.sideId)?.toEmail}`} · {sideById.get(m.sideId)?.subject}
                        </span>
                      ) : (
                        m.internal && m.authorType !== "system" && <span className="pill bg-warn/15 text-warn">Internal note</span>
                      )}
                    </span>
                    <time className="text-xs text-muted" dateTime={m.createdAt.toISOString()} title={m.createdAt.toLocaleString("en-US")}>{timeAgo(m.createdAt)}</time>
                  </p>
                  {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                  {m.translation && (
                    <div className="grid gap-1 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                      <span className="text-xs font-medium text-muted">Translated from {languageLabel(m.translatedFrom)}</span>
                      <p className="whitespace-pre-wrap break-words">{m.translation}</p>
                    </div>
                  )}
                  {m.original && (
                    <details className="text-sm">
                      <summary className="w-max cursor-pointer text-muted">Sent translated. What {m.agentName ?? "the agent"} wrote</summary>
                      <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-surface-2 px-3 py-2">{m.original}</p>
                    </details>
                  )}
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
                  {canSplit(m) && (
                    <form action={splitTicketAction} className="justify-self-end">
                      <input type="hidden" name="messageId" value={m.id} />
                      <input type="hidden" name="number" value={ticket.number} />
                      <button className="link text-xs text-muted" title="Move this message into a ticket of its own">Split into a new ticket</button>
                    </form>
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
                {i === teachAt && <TeachAi ticketId={ticket.id} subject={ticket.subject} customer={customer.name?.split(" ")[0] || "the customer"} />}
              </li>
            );
          })}
        </ol>

        {repeat && <RepeatPrompt number={ticket.number} prompt={repeat} />}

        {ticket.deletedAt && !s.viewer ? (
          <p className="card p-4 text-sm text-muted">Restore this ticket to reply to it.</p>
        ) : s.viewer ? (
          <p className="card p-4 text-sm text-muted">You have a viewer seat, so you can read this ticket but not reply. An admin can make you an agent in Settings.</p>
        ) : (
        <>
        <ScheduledReplies
          number={ticket.number}
          rows={waiting.map((w) => ({
            id: w.id,
            body: w.body,
            sendAt: w.sendAt.toISOString(),
            by: agents.find((a) => a.userId === w.userId)?.name ?? "a former teammate",
            status: w.status === "held" ? "held" : "scheduled",
            heldReason: w.heldReason,
          }))}
        />
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
          customerLanguage={foreignCustomer ? { code: foreignCustomer, label: languageLabel(foreignCustomer) } : null}
          draftKey={`${s.userId}:${ticket.id}`}
        />
        </>
        )}
      </div>

      <aside className="grid content-start gap-5 self-start border-t border-line pt-5 text-sm xl:sticky xl:top-8 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-6">
        <section className="grid gap-2">
          <h2 className="sr-only">Customer</h2>
          <div className="flex items-center gap-3">
            <Avatar name={customer.name || customer.email} className="size-10 text-sm" />
            <div className="min-w-0">
              <p className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{customer.name || customer.email}</span>
                {customer.vip && <span className="chip shrink-0 border-accent/40 bg-accent-soft font-semibold text-accent">VIP</span>}
              </p>
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
          <CustomerProfile customerId={customer.id} number={ticket.number} notes={customer.notes} vip={customer.vip} canEdit={!s.viewer} error={customerError} />
        </section>

        {!s.viewer && !ticket.deletedAt && (
          <form action={followTicketAction} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <input type="hidden" name="ticketId" value={ticket.id} />
            <input type="hidden" name="number" value={ticket.number} />
            <input type="hidden" name="on" value={following.some((f) => f.userId === s.userId) ? "0" : "1"} />
            <button className="btn btn-secondary btn-sm" title="Get an email when the customer writes back or a teammate replies">
              {following.some((f) => f.userId === s.userId) ? "Following" : "Follow"}
            </button>
            {following.length > 0 && <span className="min-w-0 truncate text-xs text-muted">Followed by {following.map((f) => (f.userId === s.userId ? "you" : f.name)).join(", ")}</span>}
          </form>
        )}

        <fieldset disabled={s.viewer} className="contents">
        <div className="grid grid-cols-2 gap-3 border-t border-line pt-4">
        <form key={`status-${ticket.status}`} action={updateTicketAction} className="grid gap-1.5">
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
            {/* Viewers can't reply, so they're only listed when one already holds the ticket. */}
            {agents.filter((a) => !a.viewer || a.userId === ticket.assigneeId).map((a) => <option key={a.userId} value={a.userId}>{a.userId === s.userId ? `${a.name} (me)` : a.name}</option>)}
            {/* Someone who has left the team still shows as the holder until it's reassigned. */}
            {ticket.assigneeId && !agents.some((a) => a.userId === ticket.assigneeId) && <option value={ticket.assigneeId} disabled>Removed agent</option>}
          </AutoSubmitSelect>
        </form>
        </div>

        <form key={`priority-${ticket.priority}`} action={updateTicketAction} className="grid gap-1.5">
          <input type="hidden" name="ticketId" value={ticket.id} />
          <input type="hidden" name="number" value={ticket.number} />
          <label htmlFor="priority" className={heading}>Priority</label>
          <AutoSubmitSelect id="priority" name="priority" defaultValue={ticket.priority} className={field}>
            {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </AutoSubmitSelect>
        </form>

        {groups.length > 0 && (
          <form key={`group-${ticket.groupId}`} action={updateTicketAction} className="grid gap-1.5">
            <input type="hidden" name="ticketId" value={ticket.id} />
            <input type="hidden" name="number" value={ticket.number} />
            <label htmlFor="groupId" className={heading}>Group</label>
            <AutoSubmitSelect id="groupId" name="groupId" defaultValue={ticket.groupId ?? ""} className={field}>
              <option value="">No group</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}{g.shareInTurn ? " (shared in turn)" : ""}</option>)}
            </AutoSubmitSelect>
          </form>
        )}

        <form key={`tags-${ticket.tags.join()}`} action={updateTicketAction} className="grid gap-1.5">
          <input type="hidden" name="ticketId" value={ticket.id} />
          <input type="hidden" name="number" value={ticket.number} />
          <label htmlFor="tags" className={heading}>Tags</label>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <TagInput tags={tagList} id="tags" name="tags" defaultValue={ticket.tags.join(", ")} className={field} />
            </div>
            <button className="btn btn-secondary btn-sm">Save</button>
          </div>
        </form>

        {ticket.channel === "email" && (
          <form key={`cc-${ticket.cc.join()}`} action={saveCcAction} className="grid gap-1.5">
            <input type="hidden" name="ticketId" value={ticket.id} />
            <input type="hidden" name="number" value={ticket.number} />
            <label htmlFor="cc" className={heading}>CC</label>
            <div className="flex gap-2">
              <input id="cc" name="cc" defaultValue={ticket.cc.join(", ")} placeholder="Copy others on replies" autoComplete="off" spellCheck={false} className={`${field} min-w-0 flex-1`} />
              <button className="btn btn-secondary btn-sm">Save</button>
            </div>
            {ccError ? <p role="alert" className="text-xs text-warn">{ccError}</p> : ticket.cc.length > 0 && <p className="text-xs text-muted">Copied on every reply. They can reply to the ticket too.</p>}
          </form>
        )}

        {!ticket.mergedIntoId && (
          <details className="grid gap-1.5" open={Boolean(mergeError)}>
            <summary className={`${heading} cursor-pointer`}>Merge into another ticket</summary>
            <form action={mergeTicketAction} className="mt-2 grid gap-1.5">
              <input type="hidden" name="ticketId" value={ticket.id} />
              <input type="hidden" name="number" value={ticket.number} />
              <p className="text-xs text-muted">Same customer wrote twice, or two people about one problem? Messages move to the other ticket and this one closes.</p>
              <div className="flex gap-2">
                <input name="into" inputMode="numeric" placeholder="Ticket number" aria-label="Ticket number to merge into" className={`${field} min-w-0 flex-1`} />
                <button className="btn btn-secondary btn-sm">Merge</button>
              </div>
              {mergeError && <p role="alert" className="text-xs text-warn">{mergeError}</p>}
            </form>
          </details>
        )}

        {!ticket.deletedAt && !ticket.mergedIntoId && ticket.status !== "closed" && <SnoozeMenu ticketId={ticket.id} number={ticket.number} />}

        {!ticket.deletedAt && (
          <form action={ticketTrashAction} className="grid gap-1.5">
            <input type="hidden" name="ticketId" value={ticket.id} />
            <input type="hidden" name="number" value={ticket.number} />
            <div className="flex flex-wrap gap-2">
              <button name="op" value="trash" className="btn btn-secondary btn-sm">Delete</button>
              {ticket.channel === "email" && !ticket.test && (
                <button name="op" value="block" className="btn btn-secondary btn-sm" title={`Their future email goes straight to the trash. Undo in Settings, Blocked senders.`}>
                  Delete and block sender
                </button>
              )}
            </div>
            <p className="text-xs text-muted">Deleted tickets stay in the trash for {TRASH_DAYS} days.</p>
          </form>
        )}

        {s.role === "admin" && (
          <details id="erase" className="grid gap-2" open={eraseMismatch || Boolean(customersError)}>
            <summary className={`${heading} cursor-pointer list-none`}>Customer data and records</summary>
            <div className="grid gap-3 pt-1">
              <p className="text-xs text-muted">
                When {customer.name || customer.email} asks for a copy of their data or to be forgotten (GDPR, CCPA).
              </p>
              <a href={`/app/export/customer?id=${customer.id}`} className="btn btn-secondary btn-sm w-fit">Download their data</a>
              <form action={eraseCustomerAction} className="grid gap-1.5">
                <input type="hidden" name="customerId" value={customer.id} />
                <input type="hidden" name="number" value={ticket.number} />
                <label htmlFor="erase-confirm" className="text-xs text-muted">
                  Erasing deletes all their tickets, messages and files, now and for good. To confirm, type <strong className="font-medium text-ink">{customer.email}</strong>
                </label>
                <input id="erase-confirm" name="confirm" autoComplete="off" spellCheck={false} className={field} />
                {eraseMismatch && <p role="alert" className="text-xs text-warn">That doesn&apos;t match their email address, so nothing was erased.</p>}
                <button className="btn btn-secondary btn-sm w-fit text-warn">Erase this customer</button>
                <p className="text-xs text-muted">Copies already sent to connected tools, like HubSpot, have to be removed there.</p>
              </form>
              <form id="merge-customers" action={mergeCustomersAction} className="grid gap-1.5 border-t border-line pt-3">
                <input type="hidden" name="customerId" value={customer.id} />
                <input type="hidden" name="number" value={ticket.number} />
                <label htmlFor="merge-into" className="text-xs text-muted">
                  Same person under two addresses? Move all of {customer.email}&apos;s tickets to the address you type, then remove this record.
                </label>
                <div className="flex gap-2">
                  <input id="merge-into" name="into" type="email" placeholder="Email to keep" autoComplete="off" className={`${field} min-w-0 flex-1`} />
                  <button className="btn btn-secondary btn-sm">Merge</button>
                </div>
                {customersError && <p role="alert" className="text-xs text-warn">{customersError}</p>}
              </form>
            </div>
          </details>
        )}
        </fieldset>

        {defined.length > 0 && (
          <form id="fields" key={`fields-${JSON.stringify(ticket.fields)}`} action={saveTicketFieldsAction} className="grid scroll-mt-6 gap-2.5 border-t border-line pt-4">
            <input type="hidden" name="ticketId" value={ticket.id} />
            <input type="hidden" name="number" value={ticket.number} />
            <p className={heading}>Fields</p>
            {fieldsNotice && <p role="alert" className="text-xs text-warn">{fieldsNotice}</p>}
            <fieldset disabled={s.viewer} className="grid gap-2.5">
              {defined.map((f) => {
                const id = `field-${f.id}`;
                const value = ticket.fields[f.name] ?? "";
                const label = (
                  <>
                    {f.name}
                    {f.requiredToClose && <span className="text-muted" title="Needed before the ticket can be closed"> *</span>}
                  </>
                );
                if (f.kind === "checkbox") {
                  return (
                    <label key={f.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name={`f:${f.name}`} defaultChecked={value === CHECKED} className="size-4 accent-[var(--accent)]" />
                      {label}
                    </label>
                  );
                }
                return (
                  <label key={f.id} htmlFor={id} className="grid gap-1">
                    <span className="text-xs text-muted">{label}</span>
                    {f.kind === "dropdown" ? (
                      <select id={id} name={`f:${f.name}`} defaultValue={value} className={field}>
                        <option value="">Not set</option>
                        {/* A value from before the choices changed stays visible until someone picks another. */}
                        {value && !f.options.includes(value) && <option value={value} disabled>{value}</option>}
                        {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input id={id} name={`f:${f.name}`} defaultValue={value} inputMode={f.kind === "number" ? "decimal" : undefined} autoComplete="off" maxLength={500} className={field} />
                    )}
                  </label>
                );
              })}
              {!s.viewer && <button className="btn btn-secondary btn-sm w-fit">Save fields</button>}
            </fieldset>
          </form>
        )}

        {fieldEntries.length > 0 && (
          <details className="group grid gap-2 border-t border-line pt-4">
            <summary className={`${heading} flex cursor-pointer list-none items-center justify-between`}>
              {ticket.source ? "Original fields" : "Other fields"}
              <span className="num text-xs text-muted group-open:hidden">{fieldEntries.length}</span>
            </summary>
            <dl className="mt-2 grid gap-2">
              {fieldEntries.map(([k, v]) => (
                <div key={k} className="grid gap-0.5">
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="break-words">{v}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}

        <Suspense fallback={null}>
          <RelatedArticles orgId={s.orgId} text={`${ticket.subject} ${thread.filter((m) => m.authorType === "customer").at(-1)?.body.slice(0, 2000) ?? ""}`} />
        </Suspense>
        <Suspense fallback={null}>
          <JiraPanel orgId={s.orgId} ticketId={ticket.id} subject={ticket.subject} canEdit={!s.viewer} />
        </Suspense>
        <Suspense fallback={null}>
          <OtherTickets orgId={s.orgId} customerId={customer.id} ticketId={ticket.id} />
        </Suspense>
        <Suspense fallback={null}>
          <CompanyPanel orgId={s.orgId} email={customer.email} customerId={customer.id} />
        </Suspense>
        {(sides.length > 0 || (!s.viewer && !ticket.deletedAt && !ticket.mergedIntoId)) && (
          <SideConversations ticketId={ticket.id} number={ticket.number} subject={ticket.subject} sides={sides} canWrite={!s.viewer && !ticket.deletedAt && !ticket.mergedIntoId} error={sideError} />
        )}
        <Suspense fallback={null}>
          <ShopifyOrders orgId={s.orgId} email={customer.email} unverified={ticket.channel === "chat"} />
        </Suspense>
        <Suspense fallback={null}>
          <StripeCustomer orgId={s.orgId} email={customer.email} unverified={ticket.channel === "chat"} />
        </Suspense>
        <Suspense fallback={null}>
          <HubSpotPanel orgId={s.orgId} email={customer.email} ticketId={ticket.id} canWrite={!s.viewer} />
        </Suspense>

        <section className="grid gap-1 border-t border-line pt-4 text-muted">
          <p>Opened {timeAgo(ticket.createdAt)}</p>
          {ticket.firstResponseAt && <p>First reply {timeAgo(ticket.firstResponseAt)}</p>}
          {sla && org && (
            <p className={sla.kind === "overdue" || sla.kind === "missed" ? "text-warn" : undefined}>
              {sla.kind === "met" && `First reply in ${shortDuration(sla.took)}, within the target of ${targetLabel(sla.minutes)}${sla.tag ? ` for ${sla.tag}` : ""}`}
              {sla.kind === "missed" && `First reply in ${shortDuration(sla.took)}, past the target of ${targetLabel(sla.minutes)}${sla.tag ? ` for ${sla.tag}` : ""}`}
              {sla.kind === "waiting" && `First reply due ${formatDue(sla.due, org.businessHours)}${sla.tag ? ` (${targetLabel(sla.minutes)} for ${sla.tag})` : ""}`}
              {sla.kind === "overdue" && `First reply overdue by ${shortDuration(sla.minutesLate)}`}
            </p>
          )}
          {nextReply && org && (
            <p className={nextReply.kind === "overdue" ? "text-warn" : undefined}>
              {nextReply.kind === "waiting" && `They wrote back. Next reply due ${formatDue(nextReply.due, org.businessHours)}`}
              {nextReply.kind === "overdue" && `They wrote back. Next reply overdue by ${shortDuration(nextReply.minutesLate)}`}
            </p>
          )}
          {resolution && org && (
            <p className={resolution.kind === "overdue" || resolution.kind === "missed" ? "text-warn" : undefined}>
              {resolution.kind === "met" && `Resolved in ${shortDuration(resolution.took)}, within the target of ${targetLabel(resolution.minutes)}${resolution.tag ? ` for ${resolution.tag}` : ""}`}
              {resolution.kind === "missed" && `Resolved in ${shortDuration(resolution.took)}, past the target of ${targetLabel(resolution.minutes)}${resolution.tag ? ` for ${resolution.tag}` : ""}`}
              {resolution.kind === "waiting" && `Resolution due ${formatDue(resolution.due, org.businessHours)}${resolution.tag ? ` (${targetLabel(resolution.minutes)} for ${resolution.tag})` : ""}`}
              {resolution.kind === "overdue" && `Resolution overdue by ${shortDuration(resolution.minutesLate)}`}
              {resolution.kind === "paused" && `Resolution clock paused while this waits on the customer`}
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}
