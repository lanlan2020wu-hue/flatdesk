"use client";

import { useState } from "react";
import { COMPETITORS } from "@/lib/pricing";

export default function AiSetupForm() {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const params = new URLSearchParams(window.location.search);
    setState("sending");
    try {
      const res = await fetch("/api/ai-setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          name: form.get("name"),
          company: form.get("company"),
          agents: Number(form.get("agents")) || null,
          monthlyTickets: Number(form.get("tickets")) || null,
          tool: form.get("tool"),
          message: form.get("message"),
          source: `ai-setup:${params.get("utm_source") ?? params.get("ref") ?? "direct"}`,
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
        Thanks. A person at Flatdesk will email you within two business days.
      </p>
    );
  }

  const label = "grid gap-1.5 text-sm font-medium";
  const field = "field font-normal";
  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      <label className={label} htmlFor="as-name">
        Your name
        <input id="as-name" name="name" autoComplete="name" maxLength={200} className={field} />
      </label>
      <label className={label} htmlFor="as-email">
        Work email
        <input id="as-email" name="email" type="email" required autoComplete="email" className={field} />
      </label>
      <label className={label} htmlFor="as-company">
        Company
        <input id="as-company" name="company" autoComplete="organization" maxLength={200} className={field} />
      </label>
      <label className={label} htmlFor="as-tool">
        Current help desk
        <select id="as-tool" name="tool" className={field} defaultValue="">
          <option value="">Choose one</option>
          {[...new Set(COMPETITORS.map((c) => c.vendor))].map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
          <option value="other">Something else</option>
        </select>
      </label>
      <label className={label} htmlFor="as-agents">
        Agents
        <input id="as-agents" name="agents" type="number" min={1} className={`${field} num`} />
      </label>
      <label className={label} htmlFor="as-tickets">
        Tickets a month
        <input id="as-tickets" name="tickets" type="number" min={1} className={`${field} num`} />
      </label>
      <label className={`${label} sm:col-span-2`} htmlFor="as-message">
        What should the AI handle?
        <textarea id="as-message" name="message" rows={4} maxLength={4000} className={field} placeholder="The questions you get most, where your docs live, anything the AI must never answer." />
      </label>
      <div aria-hidden="true" className="sr-only">
        <label>
          Leave this empty
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <button type="submit" disabled={state === "sending"} className="btn btn-primary sm:col-span-2 sm:w-max">
        {state === "sending" ? "Sending…" : "Request an AI setup"}
      </button>
      {state === "error" && <p className="text-sm text-warn sm:col-span-2">{message}</p>}
    </form>
  );
}
