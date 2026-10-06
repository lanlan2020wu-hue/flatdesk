"use client";

import { useActionState, useState } from "react";
import { addWebhookAction, type NewActionState } from "@/app/app/actions/server";

export function NewWebhookActionForm() {
  const [state, action, pending] = useActionState<NewActionState, FormData>(addWebhookAction, { error: null });
  const [lookup, setLookup] = useState(false);
  if (state.secret) {
    return (
      <div role="status" className="grid gap-2 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm">
        <p className="font-medium">Action added. It&apos;s on and needs approval until you change that below.</p>
        <p>
          Each call is signed with this secret. Check <span className="num">X-Flatdesk-Signature</span> on your side (it&apos;s also shown on the action).
        </p>
        <p className="num break-all rounded-lg bg-surface px-3 py-2">{state.secret}</p>
        <a href={`#action-${state.id}`} className="link w-max text-accent">
          Go to the action
        </a>
      </div>
    );
  }
  return (
    <form action={action} className="grid gap-3">
      <label className="grid gap-1.5">
        <span className="label">Name</span>
        <input name="name" required maxLength={80} placeholder="Send a password reset" className="field text-sm" />
      </label>
      <label className="grid gap-1.5">
        <span className="label">When the AI should use it</span>
        <textarea name="whenToUse" rows={2} maxLength={1000} placeholder="When a customer says they can't sign in or forgot their password." className="field text-sm" />
      </label>
      <label className="grid gap-1.5">
        <span className="label">Your endpoint</span>
        <input name="url" required type="url" placeholder="https://api.yourapp.com/flatdesk/password-reset" autoComplete="off" spellCheck={false} className="field num text-sm" />
      </label>
      <label className="grid gap-1.5">
        <span className="label">What the AI fills in (optional, one per line)</span>
        <textarea
          name="inputs"
          rows={3}
          spellCheck={false}
          placeholder={"plan: The plan they want, like Pro or Basic\nreason: Why, in their words"}
          className="field num text-sm"
        />
        <span className="text-xs text-muted">The customer&apos;s email and the ticket are always sent, so you don&apos;t need inputs for them.</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="lookup" checked={lookup} onChange={(e) => setLookup(e.target.checked)} className="mt-1" />
        <span>
          It only looks something up, like their plan or last login. It runs straight away and the AI reads your answer.
        </span>
      </label>
      {state.error && (
        <p role="alert" className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          {state.error}
        </p>
      )}
      <button className="btn btn-primary w-max" disabled={pending}>
        {pending ? "Adding…" : "Add action"}
      </button>
    </form>
  );
}
