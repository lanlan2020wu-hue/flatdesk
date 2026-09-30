import Link from "next/link";

// The mark: a flat line through a square, for a bill that doesn't move.
// On the bank-note green field the square turns lime.
export function LogoMark({ className = "size-7", onField = false }: { className?: string; onField?: boolean }) {
  const ink = onField ? "stroke-field" : "stroke-accent-ink";
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="6" className={onField ? "fill-lime" : "fill-accent"} />
      <path d="M7 20.5c2.2-4.2 4-6 5.6-6 2.3 0 2.1 4 4.4 4 1.3 0 2.5-1.2 3.6-2.5" className={onField ? "stroke-field/40" : "stroke-accent-ink/45"} strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M7 16h18" className={ink} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="25" cy="16" r="2.4" className={onField ? "fill-field" : "fill-accent-ink"} />
    </svg>
  );
}

export default function Logo({ href = "/", onField = false }: { href?: string; onField?: boolean }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 font-display text-xl" aria-label="Flatdesk home">
      <LogoMark onField={onField} />
      <span>Flatdesk</span>
    </Link>
  );
}
