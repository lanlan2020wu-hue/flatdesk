import Link from "next/link";
import { decideAction } from "@/app/app/actions/server";
import type { RunRow } from "@/lib/ai-actions";
import { timeAgo } from "@/lib/format";

const STATUS: Record<RunRow["status"], string> = { waiting: "Waiting for approval", done: "Done", failed: "Failed", declined: "Declined" };

// AI actions on a ticket: the one waiting for a person, with the reply the
// AI will send, and what the AI already did (lib/ai-actions.ts).
export default function ActionPanel({ runs, number, canDecide, message }: { runs: RunRow[]; number: number; canDecide: boolean; message: string | null }) {
  const waiting = runs.find((r) => r.status === "waiting");
  const past = runs.filter((r) => r.status !== "waiting");
  if (!waiting && !past.length && !message) return null;
  return (
    <section className="grid gap-3" aria-label="AI actions">
      {message && (
        <p role="status" className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm">
          {message}
        </p>
      )}
      {waiting && (
        <div className="grid gap-3 rounded-[8px] border border-warn/40 bg-warn-soft px-5 py-4">
          <p className="font-semibold">The AI wants to {waiting.summary.charAt(0).toLowerCase() + waiting.summary.slice(1)}.</p>
          <p className="text-sm text-muted">
            Asked {timeAgo(waiting.createdAt)} with the action{" "}
            <Link href="/app/actions" className="link">
              {waiting.actionName}
            </Link>
            . Approving runs it, checked again first, and sends this reply. Declining changes nothing and leaves the ticket with you.
          </p>
          {waiting.reply && <p className="whitespace-pre-wrap break-words rounded-lg border border-line bg-surface px-4 py-3 text-sm">{waiting.reply}</p>}
          {canDecide ? (
            <form action={decideAction} className="flex flex-wrap gap-2">
              <input type="hidden" name="runId" value={waiting.id} />
              <input type="hidden" name="number" value={number} />
              <button name="decision" value="approve" className="btn btn-primary btn-sm">
                Approve and send
              </button>
              <button name="decision" value="decline" className="btn btn-secondary btn-sm">
                Decline
              </button>
            </form>
          ) : (
            <p className="text-sm text-muted">Someone with a full seat can approve or decline.</p>
          )}
        </div>
      )}
      {past.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">AI actions on this ticket ({past.length})</summary>
          <ul className="mt-2 grid gap-2">
            {past.map((r) => (
              <li key={r.id} className="grid gap-0.5">
                <span>
                  <span className="font-medium">{STATUS[r.status]}:</span> {r.summary}
                </span>
                <span className="text-muted">
                  {timeAgo(r.decidedAt ?? r.createdAt)}
                  {r.decidedByName ? ` · ${r.status === "declined" ? "declined" : "approved"} by ${r.decidedByName}` : ""}
                  {r.result ? ` · ${r.result.slice(0, 300)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
