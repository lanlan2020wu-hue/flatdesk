import Link from "next/link";
import { dismissSuggestionAction, saveSuggestedMacroAction } from "@/app/app/actions";
import TagInput from "@/components/TagInput";
import type { Suggestion } from "@/lib/macro-suggestions";

const field = "field";

const Spark = ({ className = "size-4" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z" />
  </svg>
);

// One repeated answer, ready to save. Everything is editable before saving.
export function SuggestionCard({ s, aiOn, tags }: { s: Suggestion; aiOn: boolean; tags: string[] }) {
  return (
    <details className="card overflow-hidden border-accent/30">
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-surface-2/60">
        <span className="grid min-w-0 gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium">{s.name}</span>
            {s.aiWritten ? <span className="chip shrink-0">Written by AI</span> : aiOn && <span className="chip shrink-0 text-muted">AI is writing it up</span>}
          </span>
          {s.question && <span className="text-sm">Customers ask: {s.question}</span>}
          <span className="text-sm text-muted">
            Sent on <strong className="num text-ink">{s.tickets}</strong> tickets
            {s.thisWeek > 0 && s.thisWeek < s.tickets && <>, {s.thisWeek} this week</>}
            {s.thisWeek === s.tickets && <> this week</>}
          </span>
        </span>
        <span className="btn btn-secondary btn-sm shrink-0">Review</span>
      </summary>
      <form action={saveSuggestedMacroAction} className="grid gap-4 border-t border-line p-5 text-sm">
        <input type="hidden" name="answer" value={s.answer} />
        <input type="hidden" name="question" value={s.question ?? ""} />
        <label className="grid gap-1.5 font-medium" htmlFor={`sname-${s.key}`}>Name<input id={`sname-${s.key}`} name="name" required defaultValue={s.name} className={`${field} font-normal`} /></label>
        <label className="grid gap-1.5 font-medium" htmlFor={`sbody-${s.key}`}>Reply<textarea id={`sbody-${s.key}`} name="body" required rows={5} defaultValue={s.body} className={`${field} font-normal`} /></label>
        <label className="grid gap-1.5 font-medium" htmlFor={`stags-${s.key}`}>Add tags<TagInput tags={tags} id={`stags-${s.key}`} name="addTags" defaultValue={s.addTags.join(", ")} placeholder="refund" className={`${field} font-normal`} /></label>
        <p className="text-muted">
          Seen on{" "}
          {s.examples.map((n, i) => (
            <span key={n}>
              {i > 0 && ", "}
              <Link href={`/app/tickets/${n}`} className="link num">#{n}</Link>
            </span>
          ))}
          {s.tickets > s.examples.length && ` and ${s.tickets - s.examples.length} more`}.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-primary">Save as macro</button>
          <button formAction={dismissSuggestionAction} formNoValidate className="link text-muted">Don&apos;t suggest this again</button>
        </div>
      </form>
    </details>
  );
}

export function SuggestionsSection({ suggestions, aiOn, tags }: { suggestions: Suggestion[]; aiOn: boolean; tags: string[] }) {
  // Nothing found yet: the page intro already says how macros get found.
  if (!suggestions.length) return null;
  return (
    <div className="grid gap-3 rounded-2xl bg-accent-soft/60 p-4 sm:p-5">
      <div className="grid gap-1">
        <p className="flex items-center gap-2 font-medium text-accent">
          <Spark />
          {suggestions.length === 1 ? "1 AI macro identified from your replies" : `${suggestions.length} AI macros identified from your replies`}
        </p>
        <p className="text-sm text-muted">Your team keeps typing these answers.{aiOn && " The AI writes each one up from the versions you sent."} Save one and it&apos;s offered on tickets that ask the same thing, and the AI uses it too. None of this uses your AI allowance.</p>
      </div>
      {suggestions.map((s) => (
        <SuggestionCard key={s.key} s={s} aiOn={aiOn} tags={tags} />
      ))}
    </div>
  );
}

// Shown under an agent's reply when it's an answer they keep sending.
export function RepeatPrompt({ number, prompt }: { number: number; prompt: { tickets: number; name: string; body: string; answer: string } }) {
  return (
    <form action={saveSuggestedMacroAction} className="enter grid gap-3 rounded-2xl border border-accent/30 bg-accent-soft p-4 text-sm shadow-sm">
      <input type="hidden" name="number" value={number} />
      <input type="hidden" name="body" value={prompt.body} />
      <input type="hidden" name="answer" value={prompt.answer} />
      <p className="flex items-start gap-2">
        <Spark className="mt-0.5 size-4 shrink-0 text-accent" />
        <span>
          <strong>You&apos;ve sent this answer on {prompt.tickets} tickets.</strong> Save it as a macro so anyone on the team can send it in one click?
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="repeat-name" className="sr-only">Macro name</label>
        <input id="repeat-name" name="name" required defaultValue={prompt.name} className="field field-sm min-w-0 flex-1 bg-surface" />
        <button className="btn btn-primary btn-sm">Save as macro</button>
        <button formAction={dismissSuggestionAction} formNoValidate className="link px-1 text-muted">Don&apos;t ask again</button>
      </div>
    </form>
  );
}
