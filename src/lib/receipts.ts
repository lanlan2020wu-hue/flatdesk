import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { aiUsage, monthKey } from "@/lib/ai";
import { PLAN } from "@/lib/pricing";

// AI receipts: every time the AI touched a ticket, itemized per month, with
// whether it counted toward the allowance and why. Admins can refund a counted
// resolution the AI got wrong; it stops counting and the ticket goes back to
// the team. Refunds are open until that month's overage has been billed.

const { orgs, aiEvents, tickets, messages } = schema;

export type ReceiptStatus = "included" | "overage" | "refunded" | "customer-replied" | "handed-off";

export const STATUS_LABEL: Record<ReceiptStatus, string> = {
  included: "Counted, included",
  overage: `Counted, overage ${"$" + PLAN.overageRate.toFixed(2)}`,
  refunded: "Refunded",
  "customer-replied": "Not counted, customer wrote back",
  "handed-off": "Not counted, handed to the team",
};

export type ReceiptLine = {
  id: string;
  at: Date;
  status: ReceiptStatus;
  ticketNumber: number | null;
  subject: string | null;
  customer: string | null;
  sources: string[];
  reason: string | null;
  refundNote: string | null;
  refundedByName: string | null;
};

type Row = {
  id: string;
  kind: "resolution" | "handoff" | "refunded" | "draft";
  overage: boolean;
  created_at: Date | string;
  sources: string[] | null;
  reason: string | null;
  refund_note: string | null;
  refunded_by_name: string | null;
  number: number | null;
  subject: string | null;
  customer: string | null;
  ai_replied: boolean;
};

function statusOf(r: Row): ReceiptStatus {
  if (r.kind === "refunded") return "refunded";
  if (r.kind === "resolution") return r.overage ? "overage" : "included";
  // A handoff after the AI already sent an answer means the customer wrote back.
  return r.ai_replied ? "customer-replied" : "handed-off";
}

export async function refundOpen(orgId: string, month: string) {
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, orgId), columns: { overageBilledMonth: true } });
  return !org?.overageBilledMonth || org.overageBilledMonth < month;
}

export async function receiptMonths(orgId: string) {
  const rows = await db.execute<{ month: string }>(
    sql`select distinct month from ai_events where org_id = ${orgId} and kind <> 'draft' order by month desc limit 24`,
  );
  const months = rows.rows.map((r) => r.month);
  const current = monthKey();
  return months.includes(current) ? months : [current, ...months];
}

export async function monthReceipt(orgId: string, month: string) {
  const result = await db.execute<Row>(sql`
    select e.id, e.kind, e.overage, e.created_at, e.sources, e.reason, e.refund_note,
      a.name as refunded_by_name, t.number, t.subject,
      coalesce(c.name, c.email) as customer,
      exists (select 1 from messages m where m.ticket_id = e.ticket_id and m.author_type = 'ai') as ai_replied
    from ai_events e
    left join tickets t on t.id = e.ticket_id
    left join customers c on c.id = t.customer_id
    left join agents a on a.org_id = e.org_id and a.user_id = e.refunded_by
    where e.org_id = ${orgId} and e.month = ${month} and e.kind <> 'draft'
    order by e.created_at desc`);

  const lines: ReceiptLine[] = result.rows.map((r) => ({
    id: r.id,
    at: new Date(r.created_at),
    status: statusOf(r),
    ticketNumber: r.number,
    subject: r.subject,
    customer: r.customer,
    sources: r.sources ?? [],
    reason: r.reason,
    refundNote: r.refund_note,
    refundedByName: r.refunded_by_name,
  }));
  const tally = (s: ReceiptStatus) => lines.filter((l) => l.status === s).length;
  const usage = await aiUsage(orgId, month);
  const overage = tally("overage");
  return {
    month,
    lines,
    included: usage.included,
    counted: tally("included") + overage,
    overage,
    overageUsd: overage * PLAN.overageRate,
    refunded: tally("refunded"),
    notCounted: tally("customer-replied") + tally("handed-off"),
  };
}

export class RefundError extends Error {}

// Marks a counted resolution as refunded. If the refunded one was inside the
// allowance and the month has overage, the earliest overage resolution moves
// inside the allowance instead, so a refund always takes one off the bill.
export async function refundResolution(orgId: string, eventId: string, by: { userId: string; name: string }, note: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}))`);
    const [event] = await tx
      .select()
      .from(aiEvents)
      .where(and(eq(aiEvents.id, eventId), eq(aiEvents.orgId, orgId)))
      .for("update");
    if (!event || event.kind !== "resolution") throw new RefundError("Only a counted AI resolution can be refunded.");
    const [org] = await tx.select({ billed: orgs.overageBilledMonth }).from(orgs).where(eq(orgs.id, orgId));
    if (org?.billed && org.billed >= event.month) throw new RefundError("This month has already been billed, so it can't be refunded here.");

    const now = new Date();
    await tx
      .update(aiEvents)
      .set({ kind: "refunded", refundedAt: now, refundedBy: by.userId, refundNote: note.slice(0, 500) || null })
      .where(eq(aiEvents.id, eventId));

    if (!event.overage) {
      const [first] = await tx
        .select({ id: aiEvents.id })
        .from(aiEvents)
        .where(and(eq(aiEvents.orgId, orgId), eq(aiEvents.month, event.month), eq(aiEvents.kind, "resolution"), eq(aiEvents.overage, true)))
        .orderBy(asc(aiEvents.createdAt))
        .limit(1);
      if (first) await tx.update(aiEvents).set({ overage: false }).where(eq(aiEvents.id, first.id));
    }

    if (event.ticketId) {
      await tx
        .update(tickets)
        .set({ resolvedByAi: false, status: "open", closedAt: null, updatedAt: now })
        .where(and(eq(tickets.id, event.ticketId), eq(tickets.orgId, orgId)));
      await tx.insert(messages).values({
        orgId,
        ticketId: event.ticketId,
        authorType: "system",
        internal: true,
        body: `${by.name} refunded the AI answer${note ? `: ${note}` : ""}. It no longer counts toward the AI allowance, and the ticket is back with the team.`,
        createdAt: now,
      });
    }
    return event;
  });
}

// One line per AI event, for accountants and for anyone checking our math.
export function receiptCsv(r: Awaited<ReturnType<typeof monthReceipt>>) {
  const cell = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // a spreadsheet would run these as formulas
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["date", "ticket", "subject", "customer", "status", "charge_usd", "saved_answers_used", "ai_reason", "refund_note"];
  const body = r.lines.map((l) =>
    [
      l.at.toISOString(),
      l.ticketNumber ?? "",
      l.subject,
      l.customer,
      STATUS_LABEL[l.status],
      l.status === "overage" ? PLAN.overageRate.toFixed(2) : "0.00",
      l.sources.join("; "),
      l.reason,
      l.refundNote,
    ]
      .map(cell)
      .join(","),
  );
  return [head.join(","), ...body].join("\n") + "\n";
}
