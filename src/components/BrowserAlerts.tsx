"use client";

import { useEffect, useState } from "react";

// Desktop notifications for new tickets that need a person and tickets given
// to you (lib/browser-alerts.ts). Each person turns them on in their own
// browser; they show only while Flatdesk is open in a tab you aren't looking at.

const PREF = "flatdesk:browser-alerts";
const CHANGED = "flatdesk:browser-alerts-changed";
const EVERY_MS = 30_000; // BROWSER_ALERTS.everyMs

type Alert = { key: string; kind: "new" | "assigned"; number: number; subject: string; customer: string };

const supported = () => typeof window !== "undefined" && "Notification" in window;

function wanted() {
  try {
    return supported() && Notification.permission === "granted" && localStorage.getItem(PREF) === "on";
  } catch {
    return false;
  }
}

function show(title: string, body: string, tag: string, href: string) {
  try {
    const n = new Notification(title, { body, tag, icon: "/apple-icon.png" });
    n.onclick = () => {
      window.focus();
      location.assign(href);
      n.close();
    };
  } catch {
    // some mobile browsers only notify from a service worker
  }
}

// Runs in the app's layout for everyone who can work tickets.
export default function BrowserAlerts() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const check = () => setOn(wanted());
    const t = setTimeout(check);
    window.addEventListener(CHANGED, check);
    window.addEventListener("storage", check);
    return () => {
      clearTimeout(t);
      window.removeEventListener(CHANGED, check);
      window.removeEventListener("storage", check);
    };
  }, []);

  useEffect(() => {
    if (!on) return;
    let since: number | null = null;
    let stopped = false;
    const seen = new Set<string>();
    const poll = async () => {
      try {
        const res = await fetch(`/api/browser-alerts${since ? `?since=${since}` : ""}`, { cache: "no-store" });
        if (!res.ok || stopped) return;
        const out = (await res.json()) as { alerts: Alert[]; more: number; now: number };
        since = out.now;
        const fresh = out.alerts.filter((a) => !seen.has(a.key));
        out.alerts.forEach((a) => seen.add(a.key));
        // You're looking at Flatdesk already (and may have just assigned it yourself).
        if (document.visibilityState === "visible" && document.hasFocus()) return;
        for (const a of fresh) {
          show(a.kind === "assigned" ? `#${a.number} was assigned to you` : `#${a.number} needs a person`, `${a.customer}: ${a.subject}`, a.key, `/app/tickets/${a.number}`);
        }
        if (fresh.length && out.more > 0) show(`${out.more} more tickets need you`, "Open the inbox to see them all.", "flatdesk-more", "/app/inbox");
      } catch {
        // offline for a moment; the next check catches up
      }
    };
    void poll();
    const timer = setInterval(poll, EVERY_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [on]);

  return null;
}

// The switch in Settings.
export function BrowserAlertsToggle() {
  const [state, setState] = useState<"loading" | "unsupported" | "blocked" | "off" | "on">("loading");

  const refresh = () => {
    if (!supported()) return setState("unsupported");
    if (Notification.permission === "denied") return setState("blocked");
    setState(wanted() ? "on" : "off");
  };
  useEffect(() => {
    const t = setTimeout(refresh);
    return () => clearTimeout(t);
  }, []);

  const set = (value: "on" | "off") => {
    try {
      localStorage.setItem(PREF, value);
    } catch {
      // private browsing; it lasts for this page only
    }
    window.dispatchEvent(new Event(CHANGED));
    refresh();
  };

  const turnOn = async () => {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return refresh();
    set("on");
    show("Browser alerts are on", "You'll get one when a ticket needs a person or is assigned to you, while Flatdesk is in a background tab.", "flatdesk-on", "/app/inbox");
  };

  if (state === "loading") return <p className="text-sm text-muted">Checking this browser…</p>;
  if (state === "unsupported") return <p className="text-sm text-muted">This browser can&apos;t show alerts from websites. Try Chrome, Edge, Firefox or Safari on a computer.</p>;
  if (state === "blocked")
    return <p className="text-sm text-muted">This browser blocks notifications from Flatdesk. Allow them for this site in the browser&apos;s site settings (the icon left of the address), then reload.</p>;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {state === "on" ? (
        <>
          <span className="text-sm font-medium text-accent">On in this browser</span>
          <button type="button" onClick={() => set("off")} className="btn btn-secondary btn-sm">Turn off</button>
        </>
      ) : (
        <button type="button" onClick={turnOn} className="btn btn-secondary btn-sm">Turn on browser alerts</button>
      )}
    </div>
  );
}
