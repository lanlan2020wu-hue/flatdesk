"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelScheduledAction, sendScheduledNowAction } from "@/app/app/actions";
import LocalTime from "@/components/LocalTime";

type Row = { id: string; body: string; sendAt: string; by: string; status: "scheduled" | "held"; heldReason: string | null };

// Replies waiting to go out on this ticket (lib/scheduled-replies.ts), above
// the reply box. Cancel puts the text back in the box to edit.
export default function ScheduledReplies({ number, rows }: { number: number; rows: Row[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!rows.length) return null;

  const sendNow = (id: string) =>
    start(async () => {
      setError(null);
      const r = await sendScheduledNowAction(id, number);
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  const cancel = (id: string) =>
    start(async () => {
      setError(null);
      const r = await cancelScheduledAction(id, number);
      if (r) window.dispatchEvent(new CustomEvent("flatdesk:compose-text", { detail: r.body }));
      router.refresh();
    });

  return (
    <section aria-label="Scheduled replies" className="grid gap-2">
      {rows.map((r) => (
        <div key={r.id} className={`grid gap-2 rounded-[8px] border p-3 text-sm ${r.status === "held" ? "border-warn/50 bg-warn-soft" : "border-line bg-surface-2/60"}`}>
          <p className="font-medium">
            {r.status === "held" ? (
              <>Held, not sent: {r.heldReason ?? "it needs a look."}</>
            ) : (
              <>
                Reply scheduled for <LocalTime at={r.sendAt} /> by {r.by}
              </>
            )}
          </p>
          <p className="line-clamp-4 whitespace-pre-wrap text-muted">{r.body}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => sendNow(r.id)} className="btn btn-primary btn-sm">Send now</button>
            <button type="button" disabled={busy} onClick={() => cancel(r.id)} className="btn btn-secondary btn-sm">Cancel and edit</button>
          </div>
        </div>
      ))}
      {error && <p role="alert" className="text-sm text-warn">{error}</p>}
    </section>
  );
}
