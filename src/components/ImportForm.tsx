"use client";

import { useActionState } from "react";
import { startImportAction, type StartState } from "@/app/app/import/actions";

type Field = { name: string; label: string; placeholder?: string; secret: boolean };

export default function ImportForm({ source, name, fields, aiOn }: { source: string; name: string; fields: Field[]; aiOn: boolean }) {
  const [state, action, pending] = useActionState<StartState, FormData>(startImportAction, { error: null, values: {} });
  return (
    <form action={action} className="card grid gap-4 p-5 sm:p-6">
      <input type="hidden" name="source" value={source} />
      {fields.map((f) => (
        <label key={f.name} className="grid gap-1.5">
          <span className="label">{f.label}</span>
          <input
            name={f.name}
            type={f.secret ? "password" : "text"}
            required
            autoComplete="off"
            spellCheck={false}
            placeholder={f.placeholder}
            defaultValue={state.values[f.name]}
            className="field"
          />
        </label>
      ))}
      {aiOn ? (
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" name="aiOff" className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
          <span>
            Turn AI off before importing. Nothing from your tickets is sent to the AI provider until an admin turns it back on in Settings, Security.
            The AI test drive and AI answers wait until then.
          </span>
        </label>
      ) : (
        <p className="text-sm text-muted">AI is off for your team, so nothing you import is sent to the AI provider.</p>
      )}
      {state.error && (
        <p role="alert" className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          {state.error}
        </p>
      )}
      <button className="btn btn-primary w-max" disabled={pending}>
        {pending ? `Checking ${name}…` : "Check and start import"}
      </button>
    </form>
  );
}
