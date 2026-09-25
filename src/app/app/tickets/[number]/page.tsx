import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import AutoSubmitSelect from "@/components/AutoSubmitSelect";
import Composer from "@/components/Composer";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { STATUS_STYLE, timeAgo } from "@/lib/format";
import { getTicket, listAgents } from "@/lib/tickets";
import { replyAction, updateTicketAction } from "../../actions";

export async function generateMetadata({ params }: PageProps<"/app/tickets/[number]">) {
  return { title: `#${(await params).number}` };
}

const field = "w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm";

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
    <div className="grid gap-6 px-4 py-6 md:px-8 xl:grid-cols-[minmax(0,1fr)_260px]">
      <div className="grid min-w-0 content-start gap-4">
        <header className="grid gap-1">
          <p className="num text-sm text-muted">#{ticket.number} · {ticket.channel}</p>
          <h1 className="font-display text-2xl">{ticket.subject}</h1>
        </header>

        <ol className="grid gap-3">
          {thread.map((m) => {
            const who = m.authorType === "customer" ? customer.name || customer.email : m.authorType === "ai" ? "AI assistant" : m.authorType === "system" ? "Flatdesk" : m.agentName ?? "Agent";
            const tone = m.internal ? "border-warn bg-warn-soft" : m.authorType === "customer" ? "border-line bg-surface" : "border-accent/40 bg-accent-soft";
            return (
              <li key={m.id} className={`grid gap-1 rounded-lg border px-4 py-3 ${tone}`}>
                <p className="flex flex-wrap justify-between gap-2 text-sm">
                  <span className="font-medium">{who}{m.internal && m.authorType !== "system" && <span className="ml-2 font-normal text-warn">Internal note</span>}</span>
                  <time className="text-muted" dateTime={m.createdAt.toISOString()} title={m.createdAt.toLocaleString("en-US")}>{timeAgo(m.createdAt)}</time>
                </p>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                {m.deliveryError && <p className="text-sm text-warn">This reply wasn&apos;t emailed: {m.deliveryError}</p>}
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

      <aside className="grid content-start gap-5 text-sm">
        <section className="grid gap-1">
          <h2 className="text-xs uppercase tracking-wider text-muted">Customer</h2>
          <p className="font-medium">{customer.name || customer.email}</p>
          {customer.name && <p className="break-all text-muted">{customer.email}</p>}
        </section>

        <form key={`status-${ticket.status}`} action={updateTicketAction} className="grid gap-1">
          <input type="hidden" name="ticketId" value={ticket.id} />
          <input type="hidden" name="number" value={ticket.number} />
          <label htmlFor="status" className="text-xs uppercase tracking-wider text-muted">Status</label>
          <div className="flex items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-xs capitalize ${STATUS_STYLE[ticket.status]}`}>{ticket.status}</span>
            <AutoSubmitSelect id="status" name="status" defaultValue={ticket.status} className={field}>
              <option value="open">Open</option>
              <option value="pending">Pending</option>
              <option value="closed">Closed</option>
            </AutoSubmitSelect>
          </div>
        </form>

        <form key={`assignee-${ticket.assigneeId}`} action={updateTicketAction} className="grid gap-1">
          <input type="hidden" name="ticketId" value={ticket.id} />
          <input type="hidden" name="number" value={ticket.number} />
          <label htmlFor="assigneeId" className="text-xs uppercase tracking-wider text-muted">Assignee</label>
          <AutoSubmitSelect id="assigneeId" name="assigneeId" defaultValue={ticket.assigneeId ?? ""} className={field}>
            <option value="">Unassigned</option>
            {agents.map((a) => <option key={a.userId} value={a.userId}>{a.userId === s.userId ? `${a.name} (me)` : a.name}</option>)}
          </AutoSubmitSelect>
        </form>

        <form key={`tags-${ticket.tags.join()}`} action={updateTicketAction} className="grid gap-1">
          <input type="hidden" name="ticketId" value={ticket.id} />
          <input type="hidden" name="number" value={ticket.number} />
          <label htmlFor="tags" className="text-xs uppercase tracking-wider text-muted">Tags</label>
          <div className="flex gap-2">
            <input id="tags" name="tags" defaultValue={ticket.tags.join(", ")} className={field} />
            <button className="rounded-md border border-line px-2">Save</button>
          </div>
        </form>

        <section className="grid gap-1 text-muted">
          <p>Opened {timeAgo(ticket.createdAt)}</p>
          {ticket.firstResponseAt && <p>First reply {timeAgo(ticket.firstResponseAt)}</p>}
        </section>
      </aside>
    </div>
  );
}
