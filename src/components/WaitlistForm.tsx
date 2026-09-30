"use client";

import { useState } from "react";
import { COMPETITORS } from "@/lib/pricing";

// `stacked` lays the fields out two by two, for a narrow column.
export default function WaitlistForm({ stacked = false }: { stacked?: boolean }) {
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
          // Every application through this form is for the design-partner program.
          source: `design-partner:${params.get("utm_source") ?? params.get("ref") ?? "direct"}`,
          referrer: document.referrer,
          website: form.get("website"),
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
    return (
      <p className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3" role="status">
        <svg viewBox="0 0 20 20" className="size-5 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 10.5l3 3 7-7" /></svg>
        Thanks for applying. We&apos;ll email you within two business days about the design-partner program.
      </p>
    );
  }

  const field = "field";
  return (
    <form onSubmit={onSubmit} className={`grid gap-4 sm:items-end ${stacked ? "sm:grid-cols-[1.6fr_1fr]" : "sm:grid-cols-[2fr_1.5fr_0.8fr_auto]"}`}>
      <label className={`grid gap-1.5 text-sm font-medium ${stacked ? "sm:col-span-2" : ""}`} htmlFor="wl-email">
        Work email
        <input id="wl-email" name="email" type="email" required autoComplete="email" className={`${field} font-normal`} />
      </label>
      <label className="grid gap-1.5 text-sm font-medium" htmlFor="wl-tool">
        Current help desk
        <select id="wl-tool" name="tool" className={`${field} font-normal`} defaultValue="">
          <option value="">Choose one</option>
          {[...new Set(COMPETITORS.map((c) => c.vendor))].map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
          <option value="other">Something else</option>
        </select>
      </label>
      <label className="grid gap-1.5 text-sm font-medium" htmlFor="wl-agents">
        Agents
        <input id="wl-agents" name="agents" type="number" min={1} className={`${field} num font-normal`} />
      </label>
      <div aria-hidden="true" className="sr-only">
        <label>
          Leave this empty
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <button type="submit" disabled={state === "sending"} className={`btn btn-primary ${stacked ? "sm:col-span-2" : ""}`}>
        {state === "sending" ? "Sending…" : "Apply as a design partner"}
      </button>
      {state === "error" && <p className="text-sm text-warn sm:col-span-4">{message}</p>}
    </form>
  );
}
