import Link from "next/link";
import { and, desc, eq, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { timeAgo } from "@/lib/format";
import { hubspotForCustomer, jiraForTicket, shopifyForCustomer, stripeForCustomer } from "@/lib/integrations";
import { EscalateForm } from "@/components/IntegrationForms";

// Panels in the ticket's side rail about the customer: their other tickets,
// and data from the team's connected Shopify store and Stripe account. Each
// loads on its own (under Suspense), so a slow store never holds up the ticket.

const heading = "eyebrow";
const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export async function OtherTickets({ orgId, customerId, ticketId }: { orgId: string; customerId: string; ticketId: string }) {
  const { tickets } = schema;
  const rows = await db
    .select({ number: tickets.number, subject: tickets.subject, status: tickets.status, createdAt: tickets.createdAt })
    .from(tickets)
    .where(and(eq(tickets.orgId, orgId), eq(tickets.customerId, customerId), ne(tickets.id, ticketId)))
    .orderBy(desc(tickets.createdAt))
    .limit(5);
  if (rows.length === 0) return null;
  return (
    <section className="grid gap-2 border-t border-line pt-4">
      <h2 className={heading}>Their other tickets</h2>
      <ul className="grid gap-1.5">
        {rows.map((t) => (
          <li key={t.number} className="grid">
            <Link href={`/app/tickets/${t.number}`} className="link truncate">{t.subject}</Link>
            <span className="text-xs text-muted">
              <span className="num">#{t.number}</span> · <span className="capitalize">{t.status}</span> · {timeAgo(t.createdAt)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Failed({ what, error }: { what: string; error: string }) {
  return (
    <p className="text-muted">
      {what} couldn&apos;t be loaded: {error} <Link href="/app/integrations" className="link">Integrations</Link>
    </p>
  );
}

export async function ShopifyOrders({ orgId, email, unverified }: { orgId: string; email: string; unverified: boolean }) {
  const result = await shopifyForCustomer(orgId, email);
  if (result.state === "off") return null;
  return (
    <section className="grid gap-2 border-t border-line pt-4">
      <h2 className={heading}>Shopify orders</h2>
      {result.state === "error" && <Failed what="Orders" error={result.error} />}
      {result.state === "ok" && result.data.length === 0 && <p className="text-muted">No orders with this email.</p>}
      {result.state === "ok" && result.data.length > 0 && (
        <>
          {/* Chat visitors type their email, so the orders may not be theirs. */}
          {unverified && <p className="text-xs text-warn">This email wasn&apos;t verified. Check it&apos;s really them before sharing order details.</p>}
          <ul className="grid gap-3">
            {result.data.map((o) => (
              <li key={o.id} className="grid gap-0.5">
                <p className="flex items-baseline justify-between gap-2">
                  <a href={o.adminUrl} target="_blank" rel="noopener" className="link num font-medium">{o.name}</a>
                  <span className="num">{o.total}</span>
                </p>
                <p className="text-xs text-muted">{date(o.createdAt)} · {o.paid} · {o.fulfillment}</p>
                {o.items.length > 0 && <p className="text-xs break-words">{o.items.join(", ")}</p>}
                {o.tracking.map((t, i) => (
                  <p key={i} className="text-xs">
                    {t.company ? `${t.company} ` : "Tracking "}
                    {t.url ? <a href={t.url} target="_blank" rel="noopener noreferrer" className="link num">{t.number ?? "track"}</a> : <span className="num select-all">{t.number}</span>}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export async function StripeCustomer({ orgId, email, unverified }: { orgId: string; email: string; unverified: boolean }) {
  const result = await stripeForCustomer(orgId, email);
  if (result.state === "off") return null;
  const c = result.state === "ok" ? result.data : null;
  return (
    <section className="grid gap-2 border-t border-line pt-4">
      <h2 className={heading}>Stripe</h2>
      {result.state === "error" && <Failed what="Stripe" error={result.error} />}
      {result.state === "ok" && !c && <p className="text-muted">No Stripe customer with this email.</p>}
      {c && (
        <>
          {unverified && <p className="text-xs text-warn">This email wasn&apos;t verified. Check it&apos;s really them before sharing billing details.</p>}
          <p className="text-muted">
            <a href={c.dashboardUrl} target="_blank" rel="noopener" className="link">Customer since {date(c.since)}</a>
            {c.others > 0 && ` · ${c.others} more with this email`}
          </p>
          {c.subscriptions.map((sub, i) => (
            <div key={i} className="grid gap-0.5">
              <p className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{sub.plan}</span>
                <span className={`capitalize ${["past due", "unpaid", "incomplete"].includes(sub.status) ? "text-warn" : "text-muted"}`}>{sub.status}</span>
              </p>
              <p className="num text-xs text-muted">
                {sub.amount}
                {sub.renews && ` · renews ${date(sub.renews)}`}
                {sub.cancelAt && ` · ends ${date(sub.cancelAt)}`}
              </p>
            </div>
          ))}
          {c.payments.length > 0 && (
            <ul className="grid gap-1 pt-1">
              {c.payments.map((p, i) => (
                <li key={i} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="text-muted">{date(p.date)}</span>
                  <span className="num">{p.amount}</span>
                  <span className={p.status === "failed" ? "text-warn" : p.refunded ? "text-ink" : "text-muted"}>{p.status}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

export async function HubSpotPanel({ orgId, email }: { orgId: string; email: string }) {
  const result = await hubspotForCustomer(orgId, email);
  if (result.state === "off") return null;
  const c = result.state === "ok" ? result.data : null;
  const rows = c
    ? ([
        ["Company", c.company],
        ["Title", c.title],
        ["Stage", c.stage],
        ["Lead status", c.leadStatus],
        ["Owner", c.owner],
        ["Phone", c.phone],
      ] as const).filter(([, v]) => v)
    : [];
  return (
    <section className="grid gap-2 border-t border-line pt-4">
      <h2 className={heading}>HubSpot</h2>
      {result.state === "error" && <Failed what="HubSpot" error={result.error} />}
      {result.state === "ok" && !c && <p className="text-muted">No HubSpot contact with this email.</p>}
      {c && (
        <>
          <a href={c.url} target="_blank" rel="noopener" className="link w-max font-medium">{c.name ?? "Open contact"}</a>
          {rows.length > 0 && (
            <dl className="grid gap-1.5">
              {rows.map(([k, v]) => (
                <div key={k} className="grid gap-0.5">
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="break-words">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </section>
  );
}

export async function JiraPanel({ orgId, ticketId, subject, canEdit }: { orgId: string; ticketId: string; subject: string; canEdit: boolean }) {
  const result = await jiraForTicket(orgId, ticketId);
  if (result.state === "off") return null;
  const connected = !(result.state === "ok" && result.data.some((i) => i.status === "Jira isn't connected"));
  return (
    <section className="grid gap-2 border-t border-line pt-4">
      <h2 className={heading}>Jira</h2>
      {result.state === "error" && <Failed what="Jira issues" error={result.error} />}
      {result.state === "ok" && result.data.length > 0 && (
        <ul className="grid gap-1.5">
          {result.data.map((i) => (
            <li key={i.key} className="grid">
              <p className="flex items-baseline justify-between gap-2">
                <a href={i.url} target="_blank" rel="noopener" className="link num font-medium">{i.key}</a>
                <span className={i.done ? "text-accent" : "text-muted"}>{i.status}</span>
              </p>
              {i.summary && <span className="truncate text-xs text-muted">{i.summary}</span>}
            </li>
          ))}
        </ul>
      )}
      {canEdit && connected && <EscalateForm ticketId={ticketId} subject={subject} />}
    </section>
  );
}
