// Initials in a tinted circle. The tint is picked from the name so each person keeps theirs.
const TINTS = [
  "bg-accent-soft text-accent",
  "bg-warn-soft text-warn",
  "bg-surface-2 text-ink",
];

export default function Avatar({ name, className = "size-8 text-xs" }: { name: string; className?: string }) {
  const initials = name
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  const tint = TINTS[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % TINTS.length];
  return (
    <span aria-hidden="true" className={`inline-grid shrink-0 place-items-center rounded-full font-medium ring-1 ring-line ${tint} ${className}`}>
      {initials || "?"}
    </span>
  );
}
