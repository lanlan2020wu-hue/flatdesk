import type { BusinessHours } from "@/db/schema";

// First-reply targets. A new ticket should get its first reply (from an agent
// or the AI) within the team's target, counted around the clock or only in
// business hours. Imported tickets are left out: their clock ran in the old
// help desk.

export const TARGET_CHOICES = [
  { minutes: 15, label: "15 minutes" },
  { minutes: 30, label: "30 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 120, label: "2 hours" },
  { minutes: 240, label: "4 hours" },
  { minutes: 480, label: "8 hours" },
  { minutes: 1440, label: "24 hours" },
];

export const DEFAULT_HOURS: BusinessHours = { tz: "America/New_York", days: [1, 2, 3, 4, 5], start: 9 * 60, end: 17 * 60 };

// Business hours must be open at least this long each open day. A shorter
// window makes due times weeks away and the due-time loop run for ages.
export const MIN_OPEN_MINUTES = 60;

// The shape check, without the time zone (cheap enough for every ticket).
function sensibleHours(h: BusinessHours): boolean {
  return (
    Array.isArray(h.days) &&
    h.days.length > 0 &&
    h.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) &&
    Number.isFinite(h.start) &&
    Number.isFinite(h.end) &&
    h.start >= 0 &&
    h.end <= 1440 &&
    h.end - h.start >= MIN_OPEN_MINUTES
  );
}

export function validHours(h: BusinessHours): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: h.tz });
  } catch {
    return false;
  }
  return sensibleHours(h);
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

// The weekday and minute of the day at `d` on the clock in time zone `tz`.
function localClock(d: Date, tz: string): { day: number; minute: number } {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" });
    formatters.set(tz, f);
  }
  const parts = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
  return { day: WEEKDAY[parts.weekday], minute: Number(parts.hour) * 60 + Number(parts.minute) + d.getUTCSeconds() / 60 };
}

const MIN = 60_000;

// When a first reply is due: `minutes` after `from`, skipping time outside
// business hours when there are any. Steps by whole stretches of open or
// closed time, re-reading the local clock each step so DST changes are handled.
export function dueAt(from: Date, minutes: number, hours: BusinessHours | null): Date {
  // Hours saved before the minimum existed, or otherwise broken, count
  // around the clock rather than looping or giving a nonsense time.
  if (!hours || !sensibleHours(hours) || !(minutes > 0)) return new Date(from.getTime() + Math.max(0, minutes || 0) * MIN);
  let t = from.getTime();
  let left = minutes;
  // Each pass crosses one open or closed stretch, so even a team open one hour
  // a week with a 24-hour target (about 350 passes) gets a true due time.
  for (let i = 0; i < 20_000; i++) {
    const { day, minute } = localClock(new Date(t), hours.tz);
    const open = hours.days.includes(day);
    if (open && minute < hours.start) {
      t += (hours.start - minute) * MIN;
    } else if (open && minute < hours.end) {
      const room = hours.end - minute;
      if (left <= room) return new Date(t + left * MIN);
      left -= room;
      t += room * MIN;
    } else {
      t += (1440 - minute) * MIN; // on to the next local midnight
    }
  }
  return new Date(t + left * MIN); // unreachable with valid hours
}

export type SlaTicket = { status: string; createdAt: Date; firstResponseAt: Date | null; source: string | null };
export type SlaOrg = { firstResponseMinutes: number | null; businessHours: BusinessHours | null };

export type SlaState =
  | { kind: "waiting"; due: Date; minutesLeft: number; soon: boolean } // no first reply yet
  | { kind: "overdue"; due: Date; minutesLate: number }
  | { kind: "met" | "missed"; due: Date; took: number }; // replied; took = minutes from arrival

// Where a ticket stands against the first-reply target, or null when no target applies.
export function slaState(t: SlaTicket, org: SlaOrg, now = new Date()): SlaState | null {
  if (!org.firstResponseMinutes || t.source) return null;
  const due = dueAt(t.createdAt, org.firstResponseMinutes, org.businessHours);
  if (t.firstResponseAt) {
    const took = Math.round((t.firstResponseAt.getTime() - t.createdAt.getTime()) / MIN);
    return { kind: t.firstResponseAt <= due ? "met" : "missed", due, took };
  }
  if (t.status !== "open") return null;
  const left = (due.getTime() - now.getTime()) / MIN;
  if (left < 0) return { kind: "overdue", due, minutesLate: Math.ceil(-left) };
  // "Soon" is the last quarter of the target, at most the last hour.
  return { kind: "waiting", due, minutesLeft: Math.floor(left), soon: left <= Math.min(60, org.firstResponseMinutes / 4) };
}

export function shortDuration(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
  const h = minutes / 60;
  if (h < 24) return `${h < 10 ? Number(h.toFixed(1)) : Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

export function targetLabel(minutes: number) {
  return TARGET_CHOICES.find((c) => c.minutes === minutes)?.label ?? shortDuration(minutes);
}

// A due time on the team's business-hours clock (UTC when they have none).
export function formatDue(d: Date, hours: BusinessHours | null) {
  return d.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: hours?.tz ?? "UTC", timeZoneName: "short" });
}
