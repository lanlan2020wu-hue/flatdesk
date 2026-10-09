import { closeSideAction, replySideAction, startSideAction } from "@/app/app/actions";
import { timeAgo } from "@/lib/format";
import type { sidesFor } from "@/lib/side-conversations";

// The ticket rail's side conversations: email a supplier, courier or another
// team without the customer seeing it. Their messages show in the ticket's
// timeline as notes; this lists them and holds the forms.

type Side = Awaited<ReturnType<typeof sidesFor>>[number];

const field = "field field-sm";

export default function SideConversations({ ticketId, number, subject, sides, canWrite, error }: { ticketId: string; number: number; subject: string; sides: Side[]; canWrite: boolean; error: string | null }) {
  return (
    <section id="side-conversations" className="grid gap-2 border-t border-line pt-4">
      <h2 className="eyebrow">Side conversations</h2>
      {sides.length === 0 && <p className="text-muted">Email a supplier, courier or another team about this ticket. The customer never sees it, and the answer comes back here.</p>}
      {error && <p role="alert" className="text-warn">{error}</p>}
      {sides.length > 0 && (
        <ul className="grid gap-3">
          {sides.map((side) => (
            <li key={side.id} className="grid gap-1">
              <span className="truncate font-medium">{side.subject}</span>
              <span className="truncate text-xs text-muted">
                {side.toName || side.toEmail} · {side.replies === 0 ? "no answer yet" : `${side.replies} ${side.replies === 1 ? "answer" : "answers"}`} · {timeAgo(side.lastMessageAt)}
                {side.closedAt ? " · Closed" : ""}
              </span>
              {canWrite && (
                <details className="text-sm">
                  <summary className="w-max cursor-pointer text-accent">Write to {side.toName?.split(" ")[0] || side.toEmail}</summary>
                  <form action={replySideAction} className="mt-2 grid gap-2">
                    <input type="hidden" name="sideId" value={side.id} />
                    <input type="hidden" name="number" value={number} />
                    <textarea name="body" required rows={4} aria-label={`Message to ${side.toEmail}`} className={field} />
                    <div className="flex flex-wrap items-center gap-2">
                      <button className="btn btn-secondary btn-sm">Send</button>
                      <button formAction={closeSideAction} formNoValidate name="op" value={side.closedAt ? "reopen" : "close"} className="text-sm text-muted hover:text-ink">
                        {side.closedAt ? "Reopen" : "Close"}
                      </button>
                    </div>
                  </form>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <details className="text-sm" open={Boolean(error)}>
          <summary className="w-max cursor-pointer text-accent">Start a side conversation</summary>
          <form action={startSideAction} className="mt-2 grid gap-2">
            <input type="hidden" name="ticketId" value={ticketId} />
            <input type="hidden" name="number" value={number} />
            <label className="grid gap-1">
              <span className="text-xs text-muted">To</span>
              <input name="to" type="email" required placeholder="orders@supplier.com" className={field} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-muted">Subject</span>
              <input name="subject" required defaultValue={`About ticket #${number}: ${subject}`.slice(0, 200)} maxLength={200} className={field} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-muted">Message</span>
              <textarea name="body" required rows={5} className={field} />
            </label>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" name="quote" />
              Include the customer&apos;s latest message
            </label>
            <button className="btn btn-secondary btn-sm w-fit">Send</button>
          </form>
        </details>
      )}
    </section>
  );
}
