import { applyMacroUpdateAction, dismissMacroUpdateAction } from "@/app/app/actions";
import type { Drift } from "@/lib/macro-drift";

type Update = { macro: { id: string; name: string; body: string }; drift: Drift; proposed: string; aiWritten: boolean };

// Evolving macros: the edits the team keeps making to a macro,
// and the macro rewritten with them, ready to apply.
export default function MacroUpdates({ updates, aiOn, canApply }: { updates: Update[]; aiOn: boolean; canApply: boolean }) {
  if (!updates.length) return null;
  return (
    <section aria-labelledby="macro-updates" className="grid gap-3">
      <div className="grid gap-0.5">
        <h2 id="macro-updates" className="flex items-center gap-2 font-medium">
          <svg viewBox="0 0 24 24" className="sparkle size-4 text-accent" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
          </svg>
          Your team keeps editing {updates.length === 1 ? "this macro" : "these macros"}
        </h2>
        <p className="text-sm text-muted">Agents made the same change before sending, most of the time. Apply it and the macro stays up to date.</p>
      </div>
      {updates.map((u) => (
        <article key={u.macro.id} className="card grid gap-3 border-accent/30 p-5">
          <p className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">{u.macro.name}</span>
            <span className="text-xs text-muted">Sent {u.drift.uses} times since it last changed</span>
          </p>
          <ul className="grid gap-1.5 text-sm">
            {u.drift.removed.map((r) => (
              <li key={`r${r.text}`} className="flex gap-2">
                <span className="num w-20 shrink-0 text-xs text-warn">Deleted {r.count}×</span>
                <span className="text-muted line-through">{r.text}</span>
              </li>
            ))}
            {u.drift.changed.map((c) => (
              <li key={`c${c.from}`} className="flex gap-2">
                <span className="num w-20 shrink-0 text-xs text-accent">Reworded {c.count}×</span>
                <span className="grid gap-0.5">
                  <span className="text-muted line-through">{c.from}</span>
                  <span>{c.to}</span>
                </span>
              </li>
            ))}
            {u.drift.added.map((a) => (
              <li key={`a${a.text}`} className="flex gap-2">
                <span className="num w-20 shrink-0 text-xs text-accent">Added {a.count}×</span>
                <span>{a.text}</span>
              </li>
            ))}
          </ul>
          {!canApply && <p className="text-sm text-muted">An admin can apply this update or keep the macro as it is.</p>}
          {canApply && <form action={applyMacroUpdateAction} className="grid gap-2">
            <input type="hidden" name="id" value={u.macro.id} />
            <label className="grid gap-1 text-sm">
              <span className="text-muted">{u.aiWritten ? "Updated by the AI" : aiOn ? "Updated macro (the AI is rewriting it; reload in a moment)" : "Updated macro"}</span>
              <textarea name="body" defaultValue={u.proposed} rows={Math.min(10, u.proposed.split("\n").length + 1)} className="field font-normal" />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button className="btn btn-primary btn-sm">Update macro</button>
              <button formAction={dismissMacroUpdateAction} className="link text-sm text-muted">
                Keep it as is
              </button>
              <input type="hidden" name="signature" value={u.drift.signature} />
            </div>
          </form>}
        </article>
      ))}
    </section>
  );
}
