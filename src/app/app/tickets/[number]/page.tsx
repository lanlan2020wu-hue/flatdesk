import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import AutoSubmitSelect from "@/components/AutoSubmitSelect";
import Avatar from "@/components/Avatar";
import Composer from "@/components/Composer";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { STATUS_STYLE, timeAgo } from "@/lib/format";
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
  const [agents, macros] = await Promise.all([
    listAgents(s.orgId),
    db.select().from(schema.macros).where(and(eq(schema.macros.orgId, s.orgId))).orderBy(asc(schema.macros.name)),
  ]);

  return (
    <div className="grid gap-6 px-4 py-6 md:px-8 md:py-8 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="grid min-w-0 content-start gap-5">
        <header className="grid gap-2">
          <p className="flex items-center gap-2 text-sm text-muted">
            <span className="num">#{ticket.number}</span>
            <span className="chip capitalize">{ticket.channel}</span>
            <span className={`capitalize ${STATUS_STYLE[ticket.status]}`}>{ticket.status}</span>
          </p>
          <h1 className="font-display text-3xl">{ticket.subject}</h1>
        </header>

        <ol className="grid gap-4">
          {thread.map((m) => {
            const who = m.authorType === "customer" ? customer.name || customer.email : m.authorType === "ai" ? "AI assistant" : m.authorType === "system" ? "Flatdesk" : m.agentName ?? "Agent";
            const tone = m.internal
              ? "border-warn/40 bg-warn-soft"
              : m.authorType === "customer"
                ? "border-line bg-surface"
                : "border-accent/30 bg-accent-soft";
            return (
              <li key={m.id} className="flex gap-3">
                <Avatar name={who} className="mt-1 size-8 text-[11px]" />
                <div className={`grid min-w-0 flex-1 gap-1.5 rounded-2xl rounded-tl-md border px-4 py-3 shadow-sm ${tone}`}>
                  <p className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      {who}
                      {m.internal && m.authorType !== "system" && <span className="pill bg-warn/15 text-warn">Internal note</span>}
                    </span>
                    <time className="text-xs text-muted" dateTime={m.createdAt.toISOString()} title={m.createdAt.toLocaleString("en-US")}>{timeAgo(m.createdAt)}</time>
                  </p>
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  {m.deliveryError && <p className="text-sm text-warn">This reply wasn&apos;t emailed: {m.deliveryError}</p>}
                </div>
              </li>
            );
          })}
        </ol>

        <Composer
          key={thread.length}
          action={replyAction}
          ticketId={ticket.id}
          number={ticket.number}
          status={ticket.status}
          macros={macros.map((m) => ({ id: m.id, name: m.name, body: m.body, addTags: m.addTags, setStatus: m.setStatus }))}
        />
      </div>

      <aside className="card grid content-start gap-5 self-start p-5 text-sm xl:sticky xl:top-6">
        <section className="grid gap-2">
          <h2 className={heading}>Customer</h2>
          <div className="flex items-center gap-3">
            <Avatar name={customer.name || customer.email} className="size-10 text-sm" />
            <div className="min-w-0">
              <p className="truncate font-medium">{customer.name || customer.email}</p>
              {customer.name && <p className="break-all text-muted">{customer.email}</p>}
            </div>
          </div>
        </section>

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

        <section className="grid gap-1 border-t border-line pt-4 text-muted">
          <p>Opened {timeAgo(ticket.createdAt)}</p>
          {ticket.firstResponseAt && <p>First reply {timeAgo(ticket.firstResponseAt)}</p>}
        </section>
      </aside>
    </div>
  );
}
