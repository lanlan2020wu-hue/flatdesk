"use client";

import { useEffect, useRef, useState } from "react";
import { RATINGS, type Rating } from "@/lib/csat-ratings";

type Saved = { state: "saving" } | { state: "saved"; rating: Rating } | { state: "error"; message: string };

async function send(messageId: string, body: object) {
  const res = await fetch(`/api/rate/${messageId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? "That didn't save. Please try again.");
}

// Records the rating from the link as soon as the page opens, then lets the
// customer change it or add a comment.
export default function RatingPanel({ messageId, initial, teamName, ticketNumber }: { messageId: string; initial: Rating; teamName: string; ticketNumber: number }) {
  const [saved, setSaved] = useState<Saved>({ state: "saving" });
  const [comment, setComment] = useState("");
  const [commentSent, setCommentSent] = useState(false);
  const started = useRef(false);

  async function rate(rating: Rating, change = true) {
    setSaved({ state: "saving" });
    try {
      await send(messageId, { rating, change });
      setSaved({ state: "saved", rating });
    } catch (err) {
      setSaved({ state: "error", message: (err as Error).message });
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void rate(initial, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = saved.state === "saved" ? saved.rating : initial;

  return (
    <div className="card grid w-full max-w-md gap-5 p-6 sm:p-8">
      <div className="grid gap-1">
        <p className="eyebrow">{teamName} · ticket #{ticketNumber}</p>
        <h1 className="font-display text-2xl">
          {saved.state === "saved" ? "Thanks for rating this reply." : saved.state === "error" ? "Your rating didn't save." : "Saving your rating…"}
        </h1>
        {saved.state === "error" && <p className="text-sm text-warn" role="alert">{saved.message}</p>}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Your rating">
        {RATINGS.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => rate(r.id)}
            aria-pressed={current === r.id}
            className={`btn ${current === r.id ? "btn-primary" : "btn-secondary"}`}
          >
            <span aria-hidden="true">{r.emoji}</span> {r.label}
          </button>
        ))}
      </div>
      {saved.state === "saved" &&
        (commentSent ? (
          <p className="text-sm text-muted" role="status">Thanks, {teamName} will see your comment on the ticket.</p>
        ) : (
          <form
            className="grid gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!comment.trim()) return;
              try {
                await send(messageId, { comment });
                setCommentSent(true);
              } catch (err) {
                setSaved({ state: "error", message: (err as Error).message });
              }
            }}
          >
            <label className="grid gap-1.5">
              <span className="label">Anything to add? (optional)</span>
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={2000} className="field" />
            </label>
            <button className="btn btn-secondary w-max" disabled={!comment.trim()}>Send comment</button>
          </form>
        ))}
    </div>
  );
}
