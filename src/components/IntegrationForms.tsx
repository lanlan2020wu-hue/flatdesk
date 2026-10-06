"use client";

import { useActionState, useState } from "react";
import {
  connectHubSpotAction,
  connectJiraAction,
  connectShopifyAction,
  connectStripeAction,
  createKeyAction,
  escalateAction,
  type ConnectState,
  type KeyState,
} from "@/app/app/integrations/actions";

function Notice({ state }: { state: ConnectState }) {
  if (state.error) return <p role="alert" className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{state.error}</p>;
  if (state.done) return <p role="status" className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm">{state.done}</p>;
  return null;
}

const secret = { type: "password", autoComplete: "off", spellCheck: false, className: "field num text-sm" } as const;

export function ShopifyForm({ connected }: { connected: boolean }) {
  const [state, action, pending] = useActionState<ConnectState, FormData>(connectShopifyAction, { error: null });
  // Stores that made their app before 2026 have a single token instead.
  const [legacy, setLegacy] = useState(false);
  return (
    <form action={action} className="grid gap-3">
      <label className="grid gap-1.5">
        <span className="label">Store address</span>
        <input name="domain" required placeholder="your-store.myshopify.com" autoComplete="off" spellCheck={false} className="field num text-sm" />
      </label>
      {legacy ? (
        <label className="grid gap-1.5">
          <span className="label">Admin API access token</span>
          <input name="token" required placeholder="shpat_…" {...secret} />
        </label>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="label">Client ID</span>
            <input name="clientId" required autoComplete="off" spellCheck={false} className="field num text-sm" />
          </label>
          <label className="grid gap-1.5">
            <span className="label">Client secret</span>
            <input name="clientSecret" required {...secret} />
          </label>
        </div>
      )}
      <button type="button" className="link w-max text-sm" onClick={() => setLegacy(!legacy)}>
        {legacy ? "Use a client ID and secret instead" : "My app is from before 2026 and has an access token"}
      </button>
      <Notice state={state} />
      <button className="btn btn-primary w-max" disabled={pending}>{pending ? "Checking with Shopify…" : connected ? "Replace connection" : "Connect Shopify"}</button>
    </form>
  );
}

export function StripeForm({ connected }: { connected: boolean }) {
  const [state, action, pending] = useActionState<ConnectState, FormData>(connectStripeAction, { error: null });
  return (
    <form action={action} className="grid gap-3">
      <label className="grid gap-1.5">
        <span className="label">Restricted key</span>
        <input name="key" required placeholder="rk_live_…" {...secret} />
      </label>
      <Notice state={state} />
      <button className="btn btn-primary w-max" disabled={pending}>{pending ? "Checking with Stripe…" : connected ? "Replace key" : "Connect Stripe"}</button>
    </form>
  );
}

export function HubSpotForm({ connected }: { connected: boolean }) {
  const [state, action, pending] = useActionState<ConnectState, FormData>(connectHubSpotAction, { error: null });
  return (
    <form action={action} className="grid gap-3">
      <label className="grid gap-1.5">
        <span className="label">Access token</span>
        <input name="token" required placeholder="pat-na1-…" {...secret} />
      </label>
      <Notice state={state} />
      <button className="btn btn-primary w-max" disabled={pending}>{pending ? "Checking with HubSpot…" : connected ? "Replace token" : "Connect HubSpot"}</button>
    </form>
  );
}

export function JiraForm({ connected }: { connected: boolean }) {
  const [state, action, pending] = useActionState<ConnectState, FormData>(connectJiraAction, { error: null });
  const plain = { autoComplete: "off", spellCheck: false, className: "field text-sm" } as const;
  return (
    <form action={action} className="grid gap-3">
      <label className="grid gap-1.5">
        <span className="label">Jira site</span>
        <input name="site" required placeholder="your-company.atlassian.net" {...plain} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="label">Account email</span>
          <input name="email" type="email" required {...plain} />
        </label>
        <label className="grid gap-1.5">
          <span className="label">API token</span>
          <input name="token" required {...secret} />
        </label>
        <label className="grid gap-1.5">
          <span className="label">Project key</span>
          <input name="project" required placeholder="SUP" {...plain} />
        </label>
        <label className="grid gap-1.5">
          <span className="label">Issue type</span>
          <input name="issueType" defaultValue="Bug" {...plain} />
        </label>
      </div>
      <Notice state={state} />
      <button className="btn btn-primary w-max" disabled={pending}>{pending ? "Checking with Jira…" : connected ? "Replace connection" : "Connect Jira"}</button>
    </form>
  );
}

// On a ticket: turn it into a Jira issue.
export function EscalateForm({ ticketId, subject }: { ticketId: string; subject: string }) {
  const [state, action, pending] = useActionState<ConnectState, FormData>(escalateAction, { error: null });
  return (
    <details className="group">
      <summary className="btn btn-secondary btn-sm w-max cursor-pointer list-none">Send to Jira</summary>
      <form action={action} className="mt-2 grid gap-2">
        <input type="hidden" name="ticketId" value={ticketId} />
        <label className="grid gap-1">
          <span className="text-xs text-muted">Issue summary</span>
          <input name="summary" defaultValue={subject} maxLength={250} className="field field-sm" />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted">Note for the engineers (optional)</span>
          <textarea name="note" rows={3} className="field field-sm" placeholder="Steps to reproduce, account, browser…" />
        </label>
        <p className="text-xs text-muted">The issue gets your note, the customer&apos;s first message and a link to this ticket.</p>
        <Notice state={state} />
        <button className="btn btn-primary btn-sm w-max" disabled={pending}>{pending ? "Making the issue…" : "Make the issue"}</button>
      </form>
    </details>
  );
}

export function NewKeyForm() {
  const [state, action, pending] = useActionState<KeyState, FormData>(createKeyAction, { error: null });
  return (
    <div className="grid gap-3">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <label className="grid flex-1 gap-1.5">
          <span className="label">Name</span>
          <input name="name" required maxLength={60} placeholder="Zapier" className="field text-sm" />
        </label>
        <button className="btn btn-primary" disabled={pending}>{pending ? "Making…" : "Make a key"}</button>
      </form>
      {state.error && <p role="alert" className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{state.error}</p>}
      {state.key && (
        <div role="status" className="grid gap-1.5 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2.5 text-sm">
          <span className="font-medium">Copy this key now. It won&apos;t be shown again.</span>
          <code className="num select-all break-all text-ink">{state.key}</code>
        </div>
      )}
    </div>
  );
}
