"use client";

import { useEffect, useRef, useState } from "react";

type Presence = { others: { name: string; typing: boolean }[]; latestMessageId: string | null; pageHad: string | null };

const EVERY_MS = 15_000;
// Typing counts for this long after the last keystroke in a reply box.
const TYPING_FOR_MS = 12_000;

// "Sam is viewing" or "Sam is writing a reply" on a ticket, and a warning
// when a new message lands while you're on it. See lib/presence.ts.
export default function TicketPresence({ ticketId, latestMessageId }: { ticketId: string; latestMessageId: string | null }) {
  const [state, setState] = useState<Presence | null>(null);
  const lastKey = useRef(0);
  const typingSent = useRef(false);
  // What the page showed when each beat went out, so your own reply (which
  // re-renders the page) isn't reported as something new.
  const pageHad = useRef(latestMessageId);
  useEffect(() => {
    pageHad.current = latestMessageId;
  }, [latestMessageId]);

  useEffect(() => {
    let stopped = false;
    const send = async () => {
      if (document.visibilityState === "hidden") return;
      const typing = Date.now() - lastKey.current < TYPING_FOR_MS;
      typingSent.current = typing;
      const had = pageHad.current;
      try {
        const res = await fetch("/api/presence", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticketId, typing }) });
        if (res.ok && !stopped) setState({ ...(await res.json()), pageHad: had });
      } catch {
        // offline for a moment; the next beat tries again
      }
    };
    const onInput = (e: Event) => {
      if (!(e.target instanceof HTMLTextAreaElement)) return;
      lastKey.current = Date.now();
      if (!typingSent.current) void send(); // tell others straight away when someone starts
    };
    void send();
    const timer = setInterval(send, EVERY_MS);
    document.addEventListener("input", onInput);
    document.addEventListener("visibilitychange", send);
    const leave = () => navigator.sendBeacon?.("/api/presence", new Blob([JSON.stringify({ ticketId, leaving: true })], { type: "application/json" }));
    window.addEventListener("pagehide", leave);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("input", onInput);
      document.removeEventListener("visibilitychange", send);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [ticketId]);

  if (!state) return null;
  const typing = state.others.filter((o) => o.typing);
  const viewing = state.others.filter((o) => !o.typing);
  const changed = state.pageHad === latestMessageId && state.latestMessageId !== latestMessageId;
  if (!typing.length && !viewing.length && !changed) return null;
  const names = (list: { name: string }[]) => (list.length <= 2 ? list.map((o) => o.name).join(" and ") : `${list[0].name} and ${list.length - 1} others`);
  return (
    <div role="status" aria-live="polite" className="grid gap-1.5 text-sm">
      {typing.length > 0 && (
        <p className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-warn">
          <strong className="font-medium">{names(typing)}</strong> {typing.length === 1 ? "is" : "are"} writing a reply to this ticket.
        </p>
      )}
      {viewing.length > 0 && (
        <p className="text-muted">
          {names(viewing)} {viewing.length === 1 ? "has" : "have"} this ticket open.
        </p>
      )}
      {changed && (
        <p className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2">
          Something new was added to this ticket since you opened it.{" "}
          <button type="button" className="link text-accent" onClick={() => window.location.reload()}>
            Show it
          </button>
        </p>
      )}
    </div>
  );
}
