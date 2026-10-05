// The math behind the free tools at /free-tools: staffing (Erlang C), SLA due
// times in business hours, and survey scores (CSAT, NPS) with their margins of
// error. Pure functions so the pages and the tests share one implementation.

// ---------- Staffing ----------

export type StaffingInput = {
  contactsPerHour: number;
  handleSeconds: number; // average handle time of one conversation
  targetSeconds: number; // answer within this many seconds...
  targetLevel: number; // ...for this share of contacts, 0 to 1
  shrinkage: number; // share of paid time not spent on contacts, 0 to 1
  concurrency?: number; // chats one agent handles at once (1 for phone)
};

export type StaffingResult = {
  traffic: number; // workload in erlangs: agents' worth of contacts arriving
  agents: number; // agents answering at once
  scheduled: number; // agents on the schedule once shrinkage is added
  serviceLevel: number; // share answered within the target
  waitChance: number; // share that wait at all
  averageWaitSeconds: number;
  occupancy: number; // share of answering time agents spend busy
};

// Erlang B by the stable recurrence, then Erlang C from it: the chance a
// contact has to wait when `agents` serve `traffic` erlangs.
export function erlangC(agents: number, traffic: number): number {
  if (agents <= traffic) return 1;
  let b = 1;
  for (let n = 1; n <= agents; n++) b = (traffic * b) / (n + traffic * b);
  return (agents * b) / (agents - traffic * (1 - b));
}

function staffingAt(agents: number, traffic: number, handle: number, target: number) {
  const waitChance = erlangC(agents, traffic);
  const serviceLevel = 1 - waitChance * Math.exp((-(agents - traffic) * target) / handle);
  const averageWaitSeconds = (waitChance * handle) / (agents - traffic);
  return { waitChance, serviceLevel, averageWaitSeconds, occupancy: traffic / agents };
}

const MAX_AGENTS = 2000;

export function staffing(input: StaffingInput): StaffingResult | null {
  const concurrency = Math.max(1, input.concurrency ?? 1);
  // A chat agent with several chats open works through them in parallel, the
  // usual approximation is that each one takes handle time ÷ concurrency.
  const handle = input.handleSeconds / concurrency;
  const { contactsPerHour, targetSeconds } = input;
  const level = Math.min(Math.max(input.targetLevel, 0), 0.999);
  const shrinkage = Math.min(Math.max(input.shrinkage, 0), 0.9);
  if (!(contactsPerHour > 0) || !(handle > 0) || !(targetSeconds >= 0)) return null;

  const traffic = (contactsPerHour * handle) / 3600;
  for (let agents = Math.max(1, Math.floor(traffic) + 1); agents <= MAX_AGENTS; agents++) {
    const at = staffingAt(agents, traffic, handle, targetSeconds);
    if (at.serviceLevel >= level) {
      return { traffic, agents, scheduled: Math.ceil(agents / (1 - shrinkage)), ...at };
    }
  }
  return null;
}

export type BacklogInput = {
  ticketsPerDay: number;
  minutesPerTicket: number;
  hoursPerShift: number;
  shrinkage: number;
};

// Email and other queues worked through during the day: total minutes of work
// over the minutes one agent actually spends on tickets.
export function backlogStaffing(input: BacklogInput) {
  const shrinkage = Math.min(Math.max(input.shrinkage, 0), 0.9);
  const workHours = (input.ticketsPerDay * input.minutesPerTicket) / 60;
  const perAgent = input.hoursPerShift * (1 - shrinkage);
  if (!(workHours > 0) || !(perAgent > 0)) return null;
  return { workHours, perAgentHours: perAgent, exact: workHours / perAgent, agents: Math.ceil(workHours / perAgent) };
}

// ---------- SLA due times ----------

export type BusinessHours = {
  open: number; // minutes after midnight
  close: number; // minutes after midnight, after open
  days: boolean[]; // index 0 is Sunday
  allHours?: boolean; // 24/7: every minute counts
};

const DAY = 24 * 60;
const MS = 60_000;

// "2026-10-05T14:30" read as a wall-clock time. Dates are handled as UTC
// internally so no time zone or daylight saving shift can creep in.
export function parseWallClock(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const t = Date.UTC(y, mo - 1, d, h, mi);
  return Number.isNaN(t) ? null : t / MS;
}

export function formatWallClock(minutes: number): string {
  return new Date(minutes * MS).toISOString().slice(0, 16);
}

export function hhmm(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const n = Number(m[1]) * 60 + Number(m[2]);
  return n >= 0 && n <= DAY ? n : null;
}

// When a ticket received at `start` (wall-clock minutes) is due, if the SLA
// clock only runs during business hours. Returns null when no hours are open.
export function slaDue(start: number, targetMinutes: number, hours: BusinessHours): number | null {
  if (!(targetMinutes >= 0)) return null;
  if (hours.allHours) return start + targetMinutes;
  if (!hours.days.some(Boolean) || !(hours.close > hours.open)) return null;
  let remaining = targetMinutes;
  let dayStart = Math.floor(start / DAY) * DAY;
  let cursor = start;
  for (let i = 0; i < 800; i++) {
    const weekday = new Date(dayStart * MS).getUTCDay();
    if (hours.days[weekday]) {
      const open = dayStart + hours.open;
      const close = dayStart + hours.close;
      const from = Math.max(cursor, open);
      if (from < close) {
        if (remaining <= close - from) return from + remaining;
        remaining -= close - from;
      }
    }
    dayStart += DAY;
    cursor = dayStart;
  }
  return null;
}

// Share of tickets that met the SLA, and how many more can miss this period
// before the share falls below the target.
export function slaAttainment(total: number, missed: number, target: number) {
  if (!(total > 0) || missed < 0 || missed > total) return null;
  const met = total - missed;
  return { rate: met / total, missesLeft: Math.max(0, Math.floor(total * (1 - target) + 1e-9) - missed) };
}

// ---------- Survey scores ----------

const Z95 = 1.959964;

// Wilson score interval: honest bounds for a share even with few responses.
export function wilson(successes: number, n: number) {
  if (!(n > 0)) return null;
  const p = successes / n;
  const z2 = Z95 * Z95;
  const center = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (Z95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

// counts[0] is the number of 1-star answers, counts[4] the number of 5s.
export function csat(counts: number[]) {
  const total = counts.reduce((s, n) => s + n, 0);
  if (!(total > 0)) return null;
  const satisfied = (counts[3] ?? 0) + (counts[4] ?? 0);
  const average = counts.reduce((s, n, i) => s + n * (i + 1), 0) / total;
  return { total, satisfied, score: satisfied / total, average, interval: wilson(satisfied, total)! };
}

export function nps(promoters: number, passives: number, detractors: number) {
  const total = promoters + passives + detractors;
  if (!(total > 0)) return null;
  const p = promoters / total;
  const d = detractors / total;
  const score = (p - d) * 100;
  // Each answer scores +1, 0 or -1; the margin is 1.96 standard errors of that mean.
  const variance = p + d - (p - d) ** 2;
  const margin = Z95 * Math.sqrt(variance / total) * 100;
  return { total, score, promoterShare: p, detractorShare: d, margin };
}

// How many responses a share needs for a given margin of error at 95%
// confidence, assuming the worst case (a 50/50 split).
export function responsesForMargin(margin: number) {
  if (!(margin > 0)) return null;
  return Math.ceil((Z95 * Z95 * 0.25) / (margin * margin));
}
