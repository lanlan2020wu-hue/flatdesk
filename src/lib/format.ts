export function timeAgo(date: Date, now = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export const STATUS_STYLE: Record<string, string> = {
  open: "pill bg-accent-soft text-accent",
  pending: "pill bg-warn-soft text-warn",
  closed: "pill bg-surface-2 text-muted",
};
