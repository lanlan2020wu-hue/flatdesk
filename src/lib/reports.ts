import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { csatReport, csatScore } from "@/lib/csat";
import { slaState } from "@/lib/sla";

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
    from tickets where org_id = ${orgId} and created_at >= ${since} and not test`);

  // Share of this window's tickets the AI answered and the customer didn't reopen.
  const [ai] = await rows(sql`
    select
      count(*) filter (where t.resolved_by_ai) as resolved,
      count(*) filter (where not t.resolved_by_ai and exists (
        select 1 from ai_events e where e.ticket_id = t.id and e.kind = 'handoff')) as handed_off
    from tickets t where t.org_id = ${orgId} and t.created_at >= ${since} and not t.test`);

  const agents = await rows(sql`
    select a.user_id, a.name,
      (select count(*) from messages m
        where m.org_id = a.org_id and m.author_type = 'agent' and m.author_id = a.user_id
          and not m.internal and m.created_at >= ${since}
          and not exists (select 1 from tickets t where t.id = m.ticket_id and t.test)) as replies,
      (select count(*) from tickets t
        where t.org_id = a.org_id and t.assignee_id = a.user_id and t.closed_at >= ${since} and not t.test) as closed,
      (select count(*) from tickets t
        where t.org_id = a.org_id and t.assignee_id = a.user_id and t.status <> 'closed' and not t.test) as open_now
    from agents a where a.org_id = ${orgId}
    order by replies desc, a.name`);

  const [csat, target] = await Promise.all([csatReport(orgId, since), targetReport(orgId, since)]);
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
    csat: { ...csat.all, score: csatScore(csat.all), ai: csatScore(csat.ai), team: csatScore(csat.team) },
    target,
    agents: agents.map((a) => {
      const rated = csat.byAgent.get(String(a.user_id));
      return {
        userId: String(a.user_id),
        name: String(a.name),
        replies: Number(a.replies),
        closed: Number(a.closed),
        openNow: Number(a.open_now),
        csat: rated ? csatScore(rated) : null,
        rated: rated?.total ?? 0,
      };
    }),
  };
}

// How often new tickets got their first reply within the target. Tickets still
// waiting count only once they're past it.
async function targetReport(orgId: string, since: Date) {
  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, orgId) });
  if (!org?.firstResponseMinutes && !org?.slaPolicies.length) return null;
  const tickets = await db
    .select({ status: schema.tickets.status, createdAt: schema.tickets.createdAt, firstResponseAt: schema.tickets.firstResponseAt, source: schema.tickets.source, tags: schema.tickets.tags })
    .from(schema.tickets)
    .where(and(eq(schema.tickets.orgId, orgId), gte(schema.tickets.createdAt, since), isNull(schema.tickets.source), eq(schema.tickets.test, false)))
    .limit(20000);
  const now = new Date();
  let met = 0;
  let missed = 0;
  for (const t of tickets) {
    const st = slaState(t, org, now);
    if (st?.kind === "met") met++;
    else if (st?.kind === "missed" || st?.kind === "overdue") missed++;
  }
  return { minutes: org.firstResponseMinutes, policies: org.slaPolicies.length, met, missed, share: met + missed > 0 ? met / (met + missed) : null };
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
