"use client";

import { useState } from "react";
import { COMPETITORS } from "@/lib/pricing";

export default function WaitlistForm() {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const params = new URLSearchParams(window.location.search);
    setState("sending");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          tool: form.get("tool"),
          agents: Number(form.get("agents")) || null,
          source: params.get("utm_source") ?? params.get("ref") ?? "direct",
          referrer: document.referrer,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
      setState("done");
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  }

  if (state === "done") {
    return <p className="rounded-lg bg-accent-soft px-4 py-3">You&apos;re on the list. We&apos;ll email you when your spot opens.</p>;
  }

  const field = "rounded-md border border-line bg-surface px-3 py-2 text-ink";
  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[2fr_1.5fr_0.8fr_auto] sm:items-end">
      <label className="grid gap-1 text-sm" htmlFor="wl-email">
        Work email
        <input id="wl-email" name="email" type="email" required autoComplete="email" className={field} />
      </label>
      <label className="grid gap-1 text-sm" htmlFor="wl-tool">
        Current help desk
        <select id="wl-tool" name="tool" className={field} defaultValue="">
          <option value="">Choose one</option>
          {[...new Set(COMPETITORS.map((c) => c.vendor))].map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
          <option value="other">Something else</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm" htmlFor="wl-agents">
        Agents
        <input id="wl-agents" name="agents" type="number" min={1} className={`${field} num`} />
      </label>
      <button type="submit" disabled={state === "sending"} className="rounded-md bg-accent px-4 py-2 font-medium text-accent-ink disabled:opacity-60">
        {state === "sending" ? "Joining…" : "Join the waitlist"}
      </button>
      {state === "error" && <p className="text-sm text-warn sm:col-span-4">{message}</p>}
    </form>
  );
}
