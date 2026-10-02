// A plain-words explainer for an app page: what the feature is, the steps it
// goes through, and one worked example. Open while the page has nothing in
// it yet; folded away once the team is using the feature.

export type HowStep = { title: string; body: React.ReactNode };

export default function HowItWorks({
  title,
  summary,
  steps,
  example,
  footnote,
  open = false,
}: {
  title: string;
  summary: React.ReactNode;
  steps: HowStep[];
  example?: React.ReactNode;
  footnote?: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details open={open} className="how card overflow-hidden">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-3.5 font-medium transition-colors hover:bg-surface-2/60">
        <span className="flex items-center gap-2">
          <svg viewBox="0 0 20 20" className="size-4 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="10" cy="10" r="7.5" />
            <path d="M8 7.8a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9v.6M10 13.8h.01" />
          </svg>
          {title}
        </span>
        <svg viewBox="0 0 20 20" className="chevron size-4 shrink-0 text-muted transition-transform" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 8l5 5 5-5" /></svg>
      </summary>
      <div className="grid gap-4 border-t border-line px-5 pt-4 pb-5 text-sm">
        <p>{summary}</p>
        <ol className="grid gap-3">
          {steps.map((s, i) => (
            <li key={s.title} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2">
              <span className="num text-accent">{i + 1}.</span>
              <span>
                <span className="font-medium">{s.title}.</span> <span className="text-muted">{s.body}</span>
              </span>
            </li>
          ))}
        </ol>
        {example && (
          <p className="rounded-lg bg-surface-2/70 px-4 py-3">
            <span className="font-medium">For example: </span>
            {example}
          </p>
        )}
        {footnote && <p className="text-muted">{footnote}</p>}
      </div>
    </details>
  );
}
