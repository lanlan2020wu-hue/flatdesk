// Shown while an app page loads, in place of a blank screen.
export default function Loading() {
  return (
    <div className="grid gap-3 px-4 py-6 md:px-8 md:py-8" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-48 animate-pulse rounded-lg bg-surface-2" />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-xl bg-surface-2" style={{ opacity: 1 - i * 0.15 }} />
      ))}
    </div>
  );
}
