"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Keyboard shortcuts across the app. Press ? to see them. They're off while
// typing in a box, and Esc leaves the reply box so they work again.
export const SHORTCUTS: { keys: string; does: string }[] = [
  { keys: "j / k", does: "Next or previous ticket in the inbox" },
  { keys: "Enter or o", does: "Open the highlighted ticket" },
  { keys: "x", does: "Select the highlighted ticket for a bulk change" },
  { keys: "/", does: "Search tickets" },
  { keys: "r", does: "Reply, on a ticket" },
  { keys: "n", does: "Internal note, on a ticket" },
  { keys: "Ctrl or ⌘ + Enter", does: "Send the reply or note" },
  { keys: "Esc", does: "Leave the reply box" },
  { keys: "u", does: "Back to the inbox" },
  { keys: "g then i", does: "Go to the inbox" },
  { keys: "g then m", does: "Go to tickets assigned to you" },
  { keys: "g then u", does: "Go to unassigned tickets" },
  { keys: "?", does: "Show or hide this list" },
];

const GO: Record<string, string> = { i: "/app/inbox", m: "/app/inbox?view=mine", u: "/app/inbox?view=unassigned" };

function typingIn(t: EventTarget | null) {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}

export default function Shortcuts() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const pendingG = useRef(0);
  const current = useRef(-1);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    const rows = () => [...document.querySelectorAll<HTMLAnchorElement>("a[data-ticket-row]")];
    const highlight = (i: number) => {
      const all = rows();
      if (!all.length) return;
      current.current = Math.max(0, Math.min(all.length - 1, i));
      all.forEach((a, j) => a.toggleAttribute("data-current", j === current.current));
      all[current.current].focus({ preventScroll: true });
      all[current.current].scrollIntoView({ block: "nearest" });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typingIn(e.target)) return;
      const k = e.key;
      if (k === "?") {
        e.preventDefault();
        return setOpen((o) => !o);
      }
      if (Date.now() - pendingG.current < 1500) {
        pendingG.current = 0;
        if (GO[k]) {
          e.preventDefault();
          router.push(GO[k]);
        }
        return;
      }
      const onTicket = location.pathname.startsWith("/app/tickets/");
      const all = rows();
      // Start from the row with focus, if any (clicking or tabbing moves it).
      const focused = all.indexOf(document.activeElement as HTMLAnchorElement);
      if (focused >= 0) current.current = focused;
      switch (k) {
        case "g":
          pendingG.current = Date.now();
          return;
        case "j":
        case "k":
          if (!all.length) return;
          e.preventDefault();
          return highlight(current.current < 0 ? 0 : current.current + (k === "j" ? 1 : -1));
        case "o":
        case "Enter":
          if (k === "o" && all[current.current]) {
            e.preventDefault();
            all[current.current].click();
          }
          return; // Enter on a focused row is the link's own
        case "x": {
          const box = all[current.current]?.closest("li")?.querySelector<HTMLInputElement>('input[type="checkbox"]');
          if (!box) return;
          e.preventDefault();
          box.click();
          return;
        }
        case "/": {
          const search = document.querySelector<HTMLInputElement>('input[name="q"]');
          e.preventDefault();
          if (search) search.focus();
          else router.push("/app/inbox");
          return;
        }
        case "r":
        case "n":
          if (!onTicket || !document.getElementById("composer")) return;
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("flatdesk:compose", { detail: k === "n" ? "note" : "reply" }));
          return;
        case "u":
          if (!onTicket) return;
          e.preventDefault();
          router.push("/app/inbox");
          return;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <dialog
      ref={dialog}
      onClose={() => setOpen(false)}
      onClick={(e) => e.target === e.currentTarget && setOpen(false)}
      aria-labelledby="shortcuts-title"
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40"
    >
      <div className="grid gap-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="shortcuts-title" className="text-lg font-semibold">Keyboard shortcuts</h2>
          <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary btn-sm">Close</button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="contents">
              <dt><kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-xs whitespace-nowrap">{s.keys}</kbd></dt>
              <dd className="text-muted">{s.does}</dd>
            </div>
          ))}
        </dl>
      </div>
    </dialog>
  );
}
