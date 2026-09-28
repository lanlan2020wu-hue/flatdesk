import type { QA } from "@/lib/selling-points";

// Questions as native disclosure widgets, so the answers are in the HTML for
// crawlers and work without JavaScript.
export default function Faq({ items, title = "Questions", id }: { items: QA[]; title?: string; id?: string }) {
  return (
    <section data-play="" id={id} className="grid scroll-mt-24 gap-6 md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
      <h2 className="ink font-display text-3xl">{title}</h2>
      <div className="grid border-b border-line">
        {items.map(({ q, a }) => (
          <details key={q} className="group border-t border-line">
            <summary className="flex cursor-pointer items-center justify-between gap-4 py-4 font-medium transition-colors hover:text-accent">
              <h3>{q}</h3>
              <svg viewBox="0 0 20 20" className="chevron size-4 shrink-0 text-muted transition-transform" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 8l5 5 5-5" /></svg>
            </summary>
            <p className="pb-5 text-muted">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
