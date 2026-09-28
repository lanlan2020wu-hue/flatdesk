// Shared frame for the terms and privacy pages: readable measure, numbered sections.
export default function LegalPage({ title, updated, intro, children }: { title: string; updated: string; intro: React.ReactNode; children: React.ReactNode }) {
  return (
    <article className="mx-auto grid max-w-2xl gap-8 px-4 pt-14 sm:px-6 sm:pt-20">
      <header className="grid gap-3">
        <p className="eyebrow">Legal</p>
        <h1 className="font-display text-4xl sm:text-5xl">{title}</h1>
        <p className="text-sm text-muted">Last updated {updated}</p>
        <div className="text-lg text-muted">{intro}</div>
      </header>
      <div className="legal grid gap-8">{children}</div>
    </article>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <h2 className="font-display text-2xl">{title}</h2>
      {children}
    </section>
  );
}
