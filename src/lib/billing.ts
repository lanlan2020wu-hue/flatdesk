import { clerkClient } from "@clerk/nextjs/server";
import { and, count, eq, isNotNull, isNull, sql } from "drizzle-orm";
import Stripe from "stripe";
import { db, schema } from "@/db";
import { clerkEnabled } from "@/lib/auth-config";
import { milestone } from "@/lib/funnel";
import { PLAN, type Interval, seatInvoiceAmount } from "@/lib/pricing";

// Billing runs through Stripe Checkout and the customer portal, so card
// details never touch this app. Each org has one subscription whose quantity
// is its seat count. AI overage is added once a month as a pending invoice
// item, which Stripe puts on the next invoice (annual plans get their own
// invoice for it straight away, so overage never waits a year). Seats are
// monthly at PLAN.seatPrice or yearly at PLAN.annualSeatPrice × 12, priced
// inline, so there are no Stripe Price objects to create. There are no webhooks: state is
// refreshed from Stripe when someone returns from Checkout, opens billing
// settings, or when the daily job runs.

const { orgs, agents, aiEvents } = schema;

// A new team can use everything for TRIAL_DAYS without a card. Starting the
// plan during that window keeps the rest of it as a Stripe trial, so the
// first charge lands when the 14 days are up either way.
export const TRIAL_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;
const ACTIVE = new Set(["trialing", "active", "past_due"]);

export const billingConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY);

let client: Stripe | null = null;
function stripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not set.");
  // STRIPE_API_URL points the client at a local fake in tests.
  const url = process.env.STRIPE_API_URL ? new URL(process.env.STRIPE_API_URL) : null;
  client ??= new Stripe(
    process.env.STRIPE_SECRET_KEY,
    url ? { host: url.hostname, port: Number(url.port), protocol: url.protocol === "http:" ? "http" : "https" } : undefined,
  );
  return client;
}

export const isActive = (status: string | null | undefined) => Boolean(status && ACTIVE.has(status));

export const trialEndsAt = (org: { createdAt: Date; trialDays?: number }) => new Date(org.createdAt.getTime() + (org.trialDays ?? TRIAL_DAYS) * DAY);


// "open": paid or trialing in Stripe (or billing isn't set up on this server).
// "trial": inside the no-card window. "locked": the window is over with no plan.
export type Access = { state: "open" } | { state: "trial"; daysLeft: number } | { state: "locked" };
export function access(org: { createdAt: Date; trialDays?: number; subscriptionStatus: string | null }, now = new Date()): Access {
  if (!billingConfigured() || isActive(org.subscriptionStatus)) return { state: "open" };
  const left = trialEndsAt(org).getTime() - now.getTime();
  return left > 0 ? { state: "trial", daysLeft: Math.ceil(left / DAY) } : { state: "locked" };
}

// Test-mode ids don't exist in live mode (and a deleted customer is gone), so
// a missing Stripe object means "start over", not "fail forever".
const isMissing = (err: unknown) => err instanceof Stripe.errors.StripeInvalidRequestError && err.code === "resource_missing";

async function forgetStripe(orgId: string) {
  await db
    .update(orgs)
    .set({ stripeCustomerId: null, stripeSubscriptionId: null, subscriptionStatus: null, billedSeats: null, currentPeriodEnd: null })
    .where(eq(orgs.id, orgId));
}

// Seats are the org's Clerk members: someone removed in Clerk stops being billed.
// Billed seats: members of the team, less viewers (who are never admins).
export async function seatCount(orgId: string): Promise<number> {
  const viewers = await db
    .select({ userId: agents.userId })
    .from(agents)
    .where(and(eq(agents.orgId, orgId), eq(agents.viewer, true), eq(agents.role, "agent")));
  if (clerkEnabled) {
    const clerk = await clerkClient();
    const first = await clerk.organizations.getOrganizationMembershipList({ organizationId: orgId, limit: viewers.length ? 500 : 1 });
    if (!viewers.length) return Math.max(1, first.totalCount);
    const members = new Set(first.data.map((m) => m.publicUserData?.userId));
    const viewing = viewers.filter((v) => members.has(v.userId)).length;
    return Math.max(1, first.totalCount - viewing);
  }
  const [{ n }] = await db.select({ n: count() }).from(agents).where(and(eq(agents.orgId, orgId), eq(agents.viewer, false), isNull(agents.removedAt)));
  return Math.max(1, Number(n));
}

async function getOrg(orgId: string) {
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, orgId) });
  if (!org) throw new Error("Unknown team.");
  return org;
}

async function ensureCustomer(orgId: string, email: string) {
  const org = await getOrg(orgId);
  let previous = "first";
  if (org.stripeCustomerId) {
    try {
      const existing = await stripe().customers.retrieve(org.stripeCustomerId);
      if (!existing.deleted) return org.stripeCustomerId;
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
    previous = org.stripeCustomerId;
    await forgetStripe(orgId);
  }
  // Two quick checkouts would otherwise create two customers. The key makes
  // Stripe return the same one; it names the customer being replaced, so a
  // deleted customer isn't handed back. Only the first save wins.
  let customer: Stripe.Customer;
  try {
    customer = await stripe().customers.create(
      { name: org.name, email: email || undefined, metadata: { orgId } },
      { idempotencyKey: `customer-${orgId}-${previous}` },
    );
  } catch (err) {
    // The other request is still creating it: use whatever it saved.
    const now = await getOrg(orgId);
    if (now.stripeCustomerId) return now.stripeCustomerId;
    throw err;
  }
  const [saved] = await db
    .update(orgs)
    .set({ stripeCustomerId: customer.id })
    .where(and(eq(orgs.id, orgId), isNull(orgs.stripeCustomerId)))
    .returning({ id: orgs.stripeCustomerId });
  if (saved?.id) return saved.id;
  const now = await getOrg(orgId);
  return now.stripeCustomerId ?? customer.id;
}

const seatPriceData = (interval: Interval) => ({
  currency: "usd",
  unit_amount: seatInvoiceAmount(interval) * 100,
  recurring: { interval },
});

export async function checkoutUrl(orgId: string, email: string, origin: string, interval: Interval = "month") {
  // A second Checkout (a double click, two tabs) would start a second
  // subscription that seat sync never sees, so a team with a plan manages it
  // in the portal instead.
  const current = await refreshSubscription(orgId);
  if (current.stripeSubscriptionId && isActive(current.subscriptionStatus)) return portalUrl(orgId, origin);
  const customer = await ensureCustomer(orgId, email);
  const org = await getOrg(orgId);
  // A card added during the trial isn't charged until the trial ends. Stripe
  // needs a trial end at least 48 hours out, so in the trial's last two days
  // the first charge moves to 48 hours from now rather than happening today.
  const trialEnd = trialEndsAt(org).getTime();
  const trial = trialEnd > Date.now() ? { trial_end: Math.floor(Math.max(trialEnd, Date.now() + 2 * DAY + 5 * 60_000) / 1000) } : {};
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: orgId,
    line_items: [
      {
        quantity: await seatCount(orgId),
        price_data: {
          ...seatPriceData(interval),
          product_data: { name: `${PLAN.name} seat`, description: `${PLAN.includedPerAgent} AI answers per seat included each month` },
        },
      },
    ],
    subscription_data: { ...trial, metadata: { orgId } },
    // Design-partner codes are 50% off monthly; they don't stack with the yearly price.
    allow_promotion_codes: interval === "month",
    success_url: `${origin}/app/settings?billing=done&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/app/settings?billing=cancelled`,
  });
  if (!session.url) throw new Error("Stripe didn't return a checkout link.");
  return session.url;
}

// Moves a monthly subscription to yearly billing. Stripe starts the new year
// today and credits the unused part of the current month on the first invoice.
// During a Stripe trial nothing is charged until the trial ends. A
// design-partner discount is monthly only, so it ends here: the yearly price
// replaces it rather than stacking with it.
export async function switchToAnnual(orgId: string) {
  const org = await getOrg(orgId);
  if (!org.stripeSubscriptionId || !isActive(org.subscriptionStatus)) throw new Error("This team has no plan to switch.");
  const sub = await stripe().subscriptions.retrieve(org.stripeSubscriptionId);
  const item = sub.items.data[0];
  if (!item) throw new Error("This plan has no seats to switch.");
  if (item.price.recurring?.interval === "year") return refreshSubscription(orgId);
  const product = typeof item.price.product === "string" ? item.price.product : item.price.product.id;
  await stripe().subscriptions.update(sub.id, {
    items: [{ id: item.id, quantity: item.quantity, price_data: { ...seatPriceData("year"), product } }],
    discounts: "",
    proration_behavior: "always_invoice",
  });
  return refreshSubscription(orgId);
}

export async function portalUrl(orgId: string, origin: string) {
  const org = await getOrg(orgId);
  if (!org.stripeCustomerId) throw new Error("This team has no billing account yet.");
  const session = await stripe().billingPortal.sessions.create({ customer: org.stripeCustomerId, return_url: `${origin}/app/settings` });
  return session.url;
}

// Copies the subscription's state from Stripe into the org row.
export async function refreshSubscription(orgId: string) {
  const org = await getOrg(orgId);
  if (!org.stripeCustomerId || !billingConfigured()) return org;
  let subs: Stripe.ApiList<Stripe.Subscription>;
  try {
    subs = await stripe().subscriptions.list({ customer: org.stripeCustomerId, status: "all", limit: 5 });
  } catch (err) {
    if (!isMissing(err)) throw err;
    await forgetStripe(orgId);
    return getOrg(orgId);
  }
  const sub = subs.data.find((s) => isActive(s.status)) ?? subs.data[0];
  const item = sub?.items.data[0];
  const [updated] = await db
    .update(orgs)
    .set({
      stripeSubscriptionId: sub?.id ?? null,
      subscriptionStatus: sub?.status ?? null,
      billedSeats: item?.quantity ?? null,
      billingInterval: item?.price.recurring?.interval ?? null,
      currentPeriodEnd: item ? new Date(item.current_period_end * 1000) : null,
    })
    .where(eq(orgs.id, orgId))
    .returning();
  if (isActive(sub?.status) && !updated?.onboarding.milestones?.card_added) await milestone(orgId, "card_added", { interval: item?.price.recurring?.interval });
  return updated;
}

// Keeps the subscription quantity equal to the seat count. Stripe prorates.
export async function syncSeats(orgId: string) {
  if (!billingConfigured()) return;
  const org = await getOrg(orgId);
  if (!org.stripeSubscriptionId || !isActive(org.subscriptionStatus)) return;
  const seats = await seatCount(orgId);
  if (seats === org.billedSeats) return;
  const sub = await stripe().subscriptions.retrieve(org.stripeSubscriptionId);
  const item = sub.items.data[0];
  if (!item || item.quantity === seats) return;
  // Monthly plans settle the difference on the next invoice. A yearly plan's
  // next invoice can be months away, so an added seat is invoiced now. A
  // freed yearly seat isn't refunded, so it stays paid (with its AI
  // allowance) until the renewal: the next person to join takes it without a
  // second charge, and the quantity only drops just before the year renews.
  const yearly = item.price.recurring?.interval === "year";
  const paid = item.quantity ?? 0;
  if (yearly && seats < paid && item.current_period_end * 1000 - Date.now() > 2 * DAY) {
    if (org.billedSeats !== paid) await db.update(orgs).set({ billedSeats: paid }).where(eq(orgs.id, orgId));
    return;
  }
  const proration_behavior = !yearly ? "create_prorations" : seats > paid ? "always_invoice" : "none";
  await stripe().subscriptionItems.update(item.id, { quantity: seats, proration_behavior });
  await db.update(orgs).set({ billedSeats: seats }).where(eq(orgs.id, orgId));
}

const previousMonth = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
const monthAfter = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1));
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// One lock per team and month, held by whatever changes that month's counts
// or bills it: billing, refunds and hand-backs. It's a different lock space
// from the per-team lock AI answers take (two keys, not one).
export async function lockBillingMonth(tx: Pick<Tx, "execute">, orgId: string, month: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}), hashtext(${`billing:${month}`}))`);
}

// Adds a month's AI overage (last month by default) to the customer's next
// invoice, once. Runs under the month's lock, so a refund or hand-back can't
// change the count between measuring it and recording it as billed.
export async function billOverage(orgId: string, month = previousMonth()) {
  if (!billingConfigured()) return null;
  return db.transaction(async (tx) => {
    await lockBillingMonth(tx, orgId, month);
    const [org] = await tx.select().from(orgs).where(eq(orgs.id, orgId));
    if (!org) throw new Error("Unknown team.");
    if (!org.stripeCustomerId || (org.overageBilledMonth && org.overageBilledMonth >= month)) return null;
    const n = await overageFor(tx, orgId, month);
    if (n > 0) await chargeOverage(org, month, n);
    await tx.update(orgs).set({ overageBilledMonth: month }).where(eq(orgs.id, orgId));
    return n;
  });
}

// The overage flag is set when an answer starts, but answers the customer
// replied to stop counting later, which can bring the month back under the
// allowance. So the bill is what the month ended over the allowance, never
// more than the answers that ran as overage.
async function overageFor(tx: Tx, orgId: string, month: string) {
  const [{ resolutions, flagged }] = await tx
    .select({ resolutions: count(), flagged: sql<number>`count(*) filter (where ${aiEvents.overage})` })
    .from(aiEvents)
    .where(and(eq(aiEvents.orgId, orgId), eq(aiEvents.month, month), eq(aiEvents.kind, "resolution")));
  const { aiUsage } = await import("@/lib/ai"); // ai.ts imports this file
  const { included } = await aiUsage(orgId, month, tx);
  return Math.min(Number(flagged), Math.max(0, Number(resolutions) - included));
}

// A run killed between this charge and recording it would charge again the
// next day, after Stripe's idempotency keys expire, so look for the item
// first. It can only have been created after the month ended, and every page
// of items since then is read.
async function findOverageItem(customer: string, month: string) {
  const since = Math.floor(monthAfter(month).getTime() / 1000);
  for await (const i of stripe().invoiceItems.list({ customer, limit: 100, created: { gte: since } })) {
    if (i.metadata?.overageMonth === month) return i;
  }
  return undefined;
}

async function chargeOverage(org: typeof orgs.$inferSelect, month: string, n: number) {
  const orgId = org.id;
  const customer = org.stripeCustomerId!;
  const item = await findOverageItem(customer, month);
  const already = Boolean(item);
  if (!already) {
    await stripe().invoiceItems.create(
      {
        customer,
        currency: "usd",
        amount: Math.round(n * PLAN.overageRate * 100),
        description: `AI answers over the included allowance, ${month}: ${n} × $${PLAN.overageRate.toFixed(2)}`,
        metadata: { orgId, overageMonth: month },
      },
      { idempotencyKey: `overage-${orgId}-${month}` },
    );
  }
  // A yearly plan's next invoice can be months away, and a cancelled plan has
  // none, so those get an invoice now. During a Stripe trial the item waits
  // for the first invoice, as the trial promises.
  const invoiceNow = (org.billingInterval === "year" && org.subscriptionStatus !== "trialing") || !isActive(org.subscriptionStatus);
  // An item still waiting for an invoice means an earlier run stopped before
  // creating it, so that invoice is still owed.
  if (invoiceNow && (!item || !item.invoice)) {
    await stripe().invoices.create(
      { customer, pending_invoice_items_behavior: "include", auto_advance: true, description: `AI overage, ${month}` },
      { idempotencyKey: `overage-invoice-${orgId}-${month}` },
    );
  }
}

// Every finished month not billed yet, oldest first: normally just last
// month, but a month the daily job missed entirely (an outage, a run that
// kept hitting the time limit) is still billed later rather than skipped.
// Looks back at most three months, so a team is never surprised by a charge
// for usage from long ago.
export async function billUnbilledMonths(orgId: string, now = new Date()) {
  if (!billingConfigured()) return 0;
  const org = await getOrg(orgId);
  if (!org.stripeCustomerId) return 0;
  const last = previousMonth(now);
  const oldest = previousMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)));
  const rows = await db
    .selectDistinct({ month: aiEvents.month })
    .from(aiEvents)
    .where(
      and(
        eq(aiEvents.orgId, orgId),
        eq(aiEvents.kind, "resolution"),
        eq(aiEvents.overage, true),
        sql`${aiEvents.month} <= ${last}`,
        sql`${aiEvents.month} >= ${oldest}`,
        org.overageBilledMonth ? sql`${aiEvents.month} > ${org.overageBilledMonth}` : undefined,
      ),
    );
  const months = [...new Set([...rows.map((r) => r.month), last])].sort();
  let billed = 0;
  for (const month of months) billed += (await billOverage(orgId, month)) ?? 0;
  return billed;
}

// Daily job: refresh every paying team, fix seat counts, bill unbilled overage.
// Teams run a few at a time, and teams whose overage isn't billed yet go
// first, so a run that hits the time limit still reaches everyone over a few days.
// Billing a month holds a database connection while it talks to Stripe, so
// fewer teams run at once than the pool has connections.
export async function dailyBilling({ concurrency = 3, budgetMs = 240_000 } = {}) {
  const started = Date.now();
  const rows = await db
    .select({ id: orgs.id })
    .from(orgs)
    .where(isNotNull(orgs.stripeCustomerId))
    .orderBy(sql`${orgs.overageBilledMonth} asc nulls first`);
  const results: Record<string, string> = {};
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const { id } = rows[next++];
      if (Date.now() - started > budgetMs) {
        results[id] = "skipped (time limit)";
        continue;
      }
      try {
        await refreshSubscription(id);
        // Overage first, so last month is measured against the seats it had,
        // not seats added today.
        const billed = await billUnbilledMonths(id);
        await syncSeats(id);
        results[id] = billed ? `billed ${billed} overage` : "ok";
      } catch (err) {
        console.error("daily billing failed", id, err);
        results[id] = "error";
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
