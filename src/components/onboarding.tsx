"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { inviteAction, sendTestEmailAction, type InviteState, type TestState } from "@/app/app/welcome/actions";

// Client pieces of the onboarding checklist at /app/welcome.

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// Re-reads the page every few seconds while waiting for something to arrive
// (a forwarded email), then stops after a while so an idle tab goes quiet.
export function WaitFor({ label, everyMs = 4000, forMs = 5 * 60_000 }: { label: string; everyMs?: number; forMs?: number }) {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > forMs) {
        clearInterval(t);
        setGaveUp(true);
      } else router.refresh();
    }, everyMs);
    return () => clearInterval(t);
  }, [router, everyMs, forMs]);
  return (
    <p aria-live="polite" className="flex items-center gap-2 text-sm text-muted">
      {!gaveUp && <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-accent" />}
      {gaveUp ? "Still nothing. Reload this page to keep checking." : label}
    </p>
  );
}

export function InviteForm({ suggestions, source }: { suggestions: { name: string; email: string }[]; source: string | null }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteAction, { sent: [], failed: [], error: null });
  return (
    <form action={action} className="grid gap-4">
      {suggestions.length > 0 && (
        <fieldset className="grid gap-2">
          <legend className="label mb-1">From {source ?? "your import"}</legend>
          {suggestions.map((a) => (
            <label key={a.email} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="suggested" value={a.email} defaultChecked />
              <span>
                {a.name} <span className="text-muted">{a.email}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <label className="grid gap-1.5">
        <span className="label">{suggestions.length ? "Anyone else" : "Email addresses"}</span>
        <textarea name="emails" rows={3} placeholder={"sam@yourcompany.com\nalex@yourcompany.com"} className="field" />
        <span className="text-xs text-muted">One per line, or separated by commas. Each person who joins is one seat.</span>
      </label>
      <label className="grid w-max gap-1.5">
        <span className="label">Role</span>
        <select name="role" defaultValue="agent" className="field field-sm">
          <option value="agent">Agent</option>
          <option value="admin">Admin (can change settings and billing)</option>
        </select>
      </label>
      {state.error && <p role="alert" className="text-sm text-warn">{state.error}</p>}
      {state.sent.length > 0 && <p className="text-sm text-accent">Invited {state.sent.join(", ")}.</p>}
      {state.failed.length > 0 && (
        <ul className="grid gap-0.5 text-sm text-warn">
          {state.failed.map((f) => (
            <li key={f.email}>
              {f.email}: {f.reason}
            </li>
          ))}
        </ul>
      )}
      <button className="btn btn-primary w-max" disabled={pending}>
        {pending ? "Sending…" : "Send invites"}
      </button>
    </form>
  );
}

export function TestEmailButton({ to }: { to: string }) {
  const [state, action, pending] = useActionState<TestState, FormData>(sendTestEmailAction, { error: null, sentTo: null });
  return (
    <form action={action} className="grid gap-2">
      <button className="btn btn-primary w-max" disabled={pending}>
        {pending ? "Sending…" : `Email ${to}`}
      </button>
      {state.error && <p role="alert" className="text-sm text-warn">{state.error}</p>}
    </form>
  );
}
