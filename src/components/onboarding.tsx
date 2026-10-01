"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { inviteAction, sendTestEmailAction, tryAiAction, type InviteState, type TestState, type TryState } from "@/app/app/welcome/actions";

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

// Setup's "watch the AI answer" step: what the AI should know, and a question
// to try it on. The answer appears right here; nothing is sent to anyone.
export function TryAi({ notes, saved }: { notes: string; saved: number }) {
  const [state, action, pending] = useActionState<TryState, FormData>(tryAiAction, { result: null, question: "", error: null });
  const r = state.result;
  return (
    <form action={action} className="grid gap-4">
      <label className="grid gap-1.5">
        <span className="label">1. What the AI should know</span>
        <textarea
          name="aiInstructions"
          rows={6}
          defaultValue={notes}
          placeholder={"A few lines is plenty. For example:\nWe ship from Portland within 2 business days and send a tracking link by email.\nReturns are free within 30 days: reply to the order email and we send a label.\nWe're open Monday to Friday, 9 to 5 Pacific."}
          className="field"
        />
        <span className="text-xs text-muted">
          Things like your policies, products, hours and how you like to sound.{" "}
          {saved > 0 ? `It also uses your ${saved} saved ${saved === 1 ? "reply" : "replies"}.` : "It will also use any macros and help articles you add later."} You can change this later in
          Settings.
        </span>
      </label>
      <label className="grid gap-1.5">
        <span className="label">2. A question a customer might ask</span>
        <input name="question" defaultValue={state.question} placeholder="How long does shipping take?" className="field" maxLength={2000} />
      </label>
      <button className="btn btn-primary w-max" disabled={pending}>
        {pending ? "The AI is answering…" : "Save and ask the AI"}
      </button>
      {state.error && <p role="alert" className="text-sm text-warn">{state.error}</p>}
      {r && (
        <div aria-live="polite" className={`grid gap-2 rounded-lg px-4 py-3 text-sm ${r.decision === "answer" ? "bg-accent-soft" : "bg-warn-soft"}`}>
          {r.decision === "answer" ? (
            <>
              <p className="font-medium">The AI would send this reply:</p>
              <p className="whitespace-pre-wrap">{r.reply}</p>
              {r.sources.length > 0 && <p className="text-xs text-muted">Based on: {r.sources.join(", ")}</p>}
              <p className="text-xs text-muted">This wasn&apos;t sent to anyone. Once you&apos;re live, the AI replies to new emails and chats this way and passes anything else to your team.</p>
            </>
          ) : (
            <>
              <p className="font-medium">The AI would hand this one to your team.</p>
              {r.reason && <p className="text-muted">{r.reason}</p>}
              <p className="text-muted">It only answers questions your notes cover. Add what it needs above, then ask again.</p>
            </>
          )}
        </div>
      )}
    </form>
  );
}
