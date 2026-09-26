import { sql } from "drizzle-orm";
import { db } from "@/db";

// Numbers for the reports page, over a rolling window of days.

export const REPORT_RANGES = [7, 30, 90] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: Row[] }).rows;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function teamReport(orgId: string, days: ReportRange) {
  const since = new Date(Date.now() - days * 86_400_000);

  const [volume] = await rows(sql`
    select
      count(*) as created,
      count(*) filter (where channel = 'email') as email,
      count(*) filter (where channel = 'chat') as chat,
      count(*) filter (where closed_at is not null) as closed,
      count(*) filter (where status <> 'closed') as still_open,
      percentile_cont(0.5) within group (order by extract(epoch from first_response_at - created_at))
        filter (where first_response_at is not null) as median_first_response,
      percentile_cont(0.5) within group (order by extract(epoch from closed_at - created_at))
        filter (where closed_at is not null) as median_resolution
    from tickets where org_id = ${orgId} and created_at >= ${since}`);

  // Share of this window's tickets the AI answered and the customer didn't reopen.
  const [ai] = await rows(sql`
    select
      count(*) filter (where t.resolved_by_ai) as resolved,
      count(*) filter (where not t.resolved_by_ai and exists (
        select 1 from ai_events e where e.ticket_id = t.id and e.kind = 'handoff')) as handed_off
    from tickets t where t.org_id = ${orgId} and t.created_at >= ${since}`);

  const agents = await rows(sql`
    select a.user_id, a.name,
      (select count(*) from messages m
        where m.org_id = a.org_id and m.author_type = 'agent' and m.author_id = a.user_id
          and not m.internal and m.created_at >= ${since}) as replies,
      (select count(*) from tickets t
        where t.org_id = a.org_id and t.assignee_id = a.user_id and t.closed_at >= ${since}) as closed,
      (select count(*) from tickets t
        where t.org_id = a.org_id and t.assignee_id = a.user_id and t.status <> 'closed') as open_now
    from agents a where a.org_id = ${orgId}
    order by replies desc, a.name`);

  const created = Number(volume.created);
  const resolved = Number(ai.resolved);
  return {
    days,
    created,
    email: Number(volume.email),
    chat: Number(volume.chat),
    closed: Number(volume.closed),
    stillOpen: Number(volume.still_open),
    medianFirstResponse: num(volume.median_first_response),
    medianResolution: num(volume.median_resolution),
    aiResolved: resolved,
    aiHandedOff: Number(ai.handed_off),
    aiShare: created > 0 ? resolved / created : null,
    agents: agents.map((a) => ({
      userId: String(a.user_id),
      name: String(a.name),
      replies: Number(a.replies),
      closed: Number(a.closed),
      openNow: Number(a.open_now),
    })),
  };
}

export function duration(seconds: number | null): string {
  if (seconds === null) return "–";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${Math.max(1, m)}m`;
  const h = m / 60;
  if (h < 24) return `${h < 10 ? h.toFixed(1) : Math.round(h)}h`;
  const d = h / 24;
  return `${d < 10 ? d.toFixed(1) : Math.round(d)}d`;
}
