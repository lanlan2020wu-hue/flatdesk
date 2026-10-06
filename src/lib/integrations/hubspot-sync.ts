import { and, asc, count, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { unseal } from "@/lib/import/crypto";
import { SITE } from "@/lib/site";
import { addHubSpotNote, createHubSpotContact, HubSpotError, hubspotContact } from "./hubspot";

// HubSpot write-back: a closed ticket becomes a note on the customer's
// HubSpot contact (subject, who handled it, their first message and a link),
// so sales and account managers see support history where they work. Turned
// on in Integrations; runs from the every-few-minutes cron, and from the
// "Log to HubSpot" button on a ticket. Only adds notes and, if allowed,
// contacts: it never changes or deletes what's in HubSpot.

const { integrations, tickets, customers, messages, agents } = schema;
const PER_RUN = 40; // per team, every few minutes; HubSpot allows 100 calls per 10 seconds
const EXCERPT = 600;

type Creds = { token: string; portalId: string; uiDomain: string };

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function noteHtml(t: { number: number; subject: string; status: string; assignee: string | null; messages: number; firstMessage: string | null; resolvedByAi: boolean }) {
  const first = t.firstMessage ? t.firstMessage.replace(/\s+/g, " ").trim() : "";
  const excerpt = first.length > EXCERPT ? `${first.slice(0, EXCERPT)}…` : first;
  const who = t.resolvedByAi ? "Answered by the AI." : t.assignee ? `Handled by ${escape(t.assignee)}.` : "";
  return [
    `<p><strong>Support ticket #${t.number} ${t.status === "closed" ? "closed" : `(${escape(t.status)})`}</strong>: ${escape(t.subject)}</p>`,
    `<p>${[who, `${t.messages} ${t.messages === 1 ? "message" : "messages"}.`].filter(Boolean).join(" ")}</p>`,
    excerpt ? `<p>They wrote: ${escape(excerpt)}</p>` : "",
    `<p><a href="${SITE.url}/app/tickets/${t.number}">Open in Flatdesk</a></p>`,
  ].join("");
}

export type LogResult = { ok: true; created: boolean } | { ok: false; reason: "no-contact" | "error"; error?: string };

// Logs one ticket on its customer's contact. Creates the contact first when
// there's none and the team allowed it (or `create` is passed).
export async function logTicketToHubSpot(orgId: string, ticketId: string, opts: { create?: boolean; fetcher?: typeof fetch; now?: Date } = {}): Promise<LogResult> {
  const fetcher = opts.fetcher ?? fetch;
  const [row] = await db.select().from(integrations).where(and(eq(integrations.orgId, orgId), eq(integrations.kind, "hubspot")));
  if (!row) return { ok: false, reason: "error", error: "HubSpot isn't connected." };
  const [t] = await db
    .select({ ticket: tickets, email: customers.email, name: customers.name, assignee: agents.name })
    .from(tickets)
    .innerJoin(customers, eq(customers.id, tickets.customerId))
    .leftJoin(agents, and(eq(agents.orgId, tickets.orgId), eq(agents.userId, tickets.assigneeId)))
    .where(and(eq(tickets.orgId, orgId), eq(tickets.id, ticketId)));
  if (!t) return { ok: false, reason: "error", error: "No such ticket." };
  const creds = unseal(row.credentials) as Creds;
  try {
    let contactId = (await hubspotContact(creds, t.email, fetcher))?.id ?? null;
    let created = false;
    if (!contactId && (opts.create ?? row.settings.createContacts)) {
      contactId = await createHubSpotContact(creds, { email: t.email, name: t.name }, fetcher);
      created = true;
    }
    if (!contactId) {
      await db.update(tickets).set({ crmLoggedAt: opts.now ?? new Date() }).where(eq(tickets.id, t.ticket.id)); // nothing to log it on; don't retry every run
      return { ok: false, reason: "no-contact" };
    }
    const [[{ n }], [first]] = await Promise.all([
      db.select({ n: count() }).from(messages).where(and(eq(messages.ticketId, t.ticket.id), eq(messages.internal, false))),
      db
        .select({ body: messages.body })
        .from(messages)
        .where(and(eq(messages.ticketId, t.ticket.id), eq(messages.authorType, "customer"), eq(messages.internal, false)))
        .orderBy(asc(messages.createdAt))
        .limit(1),
    ]);
    const html = noteHtml({ number: t.ticket.number, subject: t.ticket.subject, status: t.ticket.status, assignee: t.assignee, messages: Number(n), firstMessage: first?.body ?? null, resolvedByAi: t.ticket.resolvedByAi });
    await addHubSpotNote(creds, contactId, html, t.ticket.closedAt ?? opts.now ?? new Date(), fetcher);
    await db.update(tickets).set({ crmLoggedAt: opts.now ?? new Date() }).where(eq(tickets.id, t.ticket.id));
    if (row.lastError) await db.update(integrations).set({ lastError: null, lastErrorAt: null }).where(eq(integrations.id, row.id));
    return { ok: true, created };
  } catch (err) {
    const error = err instanceof HubSpotError ? err.message : "HubSpot couldn't be reached.";
    await db.update(integrations).set({ lastError: error, lastErrorAt: new Date() }).where(eq(integrations.id, row.id));
    return { ok: false, reason: "error", error };
  }
}

// The cron's part: every team with write-back on logs its tickets closed
// since it was turned on and not logged since they closed.
export async function syncHubSpot(now = new Date(), fetcher: typeof fetch = fetch): Promise<{ logged: number }> {
  const rows = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.kind, "hubspot"), sql`(${integrations.settings} ->> 'logClosed')::boolean is true`));
  let logged = 0;
  for (const row of rows) {
    const since = row.settings.logSince ? new Date(row.settings.logSince) : now;
    const due = await db
      .select({ id: tickets.id })
      .from(tickets)
      .where(
        and(
          eq(tickets.orgId, row.orgId),
          eq(tickets.status, "closed"),
          eq(tickets.test, false),
          isNull(tickets.source),
          isNull(tickets.mergedIntoId),
          gte(tickets.closedAt, since),
          or(isNull(tickets.crmLoggedAt), lt(tickets.crmLoggedAt, tickets.closedAt)),
        ),
      )
      .orderBy(asc(tickets.closedAt))
      .limit(PER_RUN);
    for (const { id } of due) {
      const r = await logTicketToHubSpot(row.orgId, id, { fetcher, now });
      if (r.ok) logged++;
      else if (r.reason === "error") break; // token or scope problem: shown on Integrations, tried again next run
    }
  }
  return { logged };
}

export async function saveHubSpotSettings(orgId: string, next: { logClosed: boolean; createContacts: boolean }, now = new Date()) {
  const [row] = await db.select().from(integrations).where(and(eq(integrations.orgId, orgId), eq(integrations.kind, "hubspot")));
  if (!row) return;
  // Turning logging on starts from now, so old tickets don't flood the timeline.
  const logSince = next.logClosed ? (row.settings.logClosed && row.settings.logSince ? row.settings.logSince : now.toISOString()) : undefined;
  await db.update(integrations).set({ settings: { ...row.settings, ...next, logSince } }).where(eq(integrations.id, row.id));
}
