import { clerkClient } from "@clerk/nextjs/server";
import { and, count, eq, isNotNull } from "drizzle-orm";
import Stripe from "stripe";
import { db, schema } from "@/db";
import { clerkEnabled } from "@/lib/auth-config";
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

export const trialEndsAt = (org: { createdAt: Date }) => new Date(org.createdAt.getTime() + TRIAL_DAYS * DAY);

// "open": paid or trialing in Stripe (or billing isn't set up on this server).
// "trial": inside the no-card window. "locked": the window is over with no plan.
export type Access = { state: "open" } | { state: "trial"; daysLeft: number } | { state: "locked" };
export function access(org: { createdAt: Date; subscriptionStatus: string | null }, now = new Date()): Access {
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
export async function seatCount(orgId: string): Promise<number> {
  if (clerkEnabled) {
    const list = await (await clerkClient()).organizations.getOrganizationMembershipList({ organizationId: orgId, limit: 1 });
    return Math.max(1, list.totalCount);
  }
  const [{ n }] = await db.select({ n: count() }).from(agents).where(eq(agents.orgId, orgId));
  return Math.max(1, Number(n));
}

async function getOrg(orgId: string) {
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, orgId) });
  if (!org) throw new Error("Unknown team.");
  return org;
}

async function ensureCustomer(orgId: string, email: string) {
  const org = await getOrg(orgId);
  if (org.stripeCustomerId) {
    try {
      const existing = await stripe().customers.retrieve(org.stripeCustomerId);
      if (!existing.deleted) return org.stripeCustomerId;
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
    await forgetStripe(orgId);
  }
  const customer = await stripe().customers.create({ name: org.name, email: email || undefined, metadata: { orgId } });
  await db.update(orgs).set({ stripeCustomerId: customer.id }).where(eq(orgs.id, orgId));
  return customer.id;
}

const seatPriceData = (interval: Interval) => ({
  currency: "usd",
  unit_amount: seatInvoiceAmount(interval) * 100,
  recurring: { interval },
});

export async function checkoutUrl(orgId: string, email: string, origin: string, interval: Interval = "month") {
  const customer = await ensureCustomer(orgId, email);
  const org = await getOrg(orgId);
  // Stripe needs a trial end at least 48 hours out; closer than that, billing starts now.
  const trialEnd = trialEndsAt(org);
  const trial = trialEnd.getTime() - Date.now() > 2 * DAY + 60_000 ? { trial_end: Math.floor(trialEnd.getTime() / 1000) } : {};
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: orgId,
    line_items: [
      {
        quantity: await seatCount(orgId),
        price_data: {
          ...seatPriceData(interval),
          product_data: { name: `${PLAN.name} seat`, description: `${PLAN.includedPerAgent} AI resolutions per seat included each month` },
        },
      },
    ],
    subscription_data: { ...trial, metadata: { orgId } },
    allow_promotion_codes: true,
    success_url: `${origin}/app/settings?billing=done&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/app/settings?billing=cancelled`,
  });
  if (!session.url) throw new Error("Stripe didn't return a checkout link.");
  return session.url;
}

// Moves a monthly subscription to yearly billing. Stripe starts the new year
// today and credits the unused part of the current month on the first invoice.
// During a Stripe trial nothing is charged until the trial ends.
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
  // next invoice can be months away, so it's invoiced now instead.
  const yearly = item.price.recurring?.interval === "year";
  await stripe().subscriptionItems.update(item.id, { quantity: seats, proration_behavior: yearly ? "always_invoice" : "create_prorations" });
  await db.update(orgs).set({ billedSeats: seats }).where(eq(orgs.id, orgId));
}

const previousMonth = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);

// Adds last month's AI overage to the customer's next invoice, once.
export async function billOverage(orgId: string, month = previousMonth()) {
  if (!billingConfigured()) return null;
  const org = await getOrg(orgId);
  if (!org.stripeCustomerId || (org.overageBilledMonth && org.overageBilledMonth >= month)) return null;
  const [{ n }] = await db
    .select({ n: count() })
    .from(aiEvents)
    .where(and(eq(aiEvents.orgId, orgId), eq(aiEvents.month, month), eq(aiEvents.kind, "resolution"), eq(aiEvents.overage, true)));
  if (Number(n) > 0) {
    // The idempotency key makes a retry after a failed update below safe.
    await stripe().invoiceItems.create(
      {
        customer: org.stripeCustomerId,
        currency: "usd",
        amount: Math.round(Number(n) * PLAN.overageRate * 100),
        description: `AI resolutions over the included allowance, ${month}: ${n} × $${PLAN.overageRate.toFixed(2)}`,
      },
      { idempotencyKey: `overage-${orgId}-${month}` },
    );
    if (org.billingInterval === "year") {
      await stripe().invoices.create(
        { customer: org.stripeCustomerId, pending_invoice_items_behavior: "include", auto_advance: true, description: `AI overage, ${month}` },
        { idempotencyKey: `overage-invoice-${orgId}-${month}` },
      );
    }
  }
  await db.update(orgs).set({ overageBilledMonth: month }).where(eq(orgs.id, orgId));
  return Number(n);
}

// Daily job: refresh every paying team, fix seat counts, bill last month's overage.
export async function dailyBilling() {
  const rows = await db.select({ id: orgs.id }).from(orgs).where(isNotNull(orgs.stripeCustomerId));
  const results: Record<string, string> = {};
  for (const { id } of rows) {
    try {
      await refreshSubscription(id);
      await syncSeats(id);
      const billed = await billOverage(id);
      results[id] = billed ? `billed ${billed} overage` : "ok";
    } catch (err) {
      console.error("daily billing failed", id, err);
      results[id] = "error";
    }
  }
  return results;
}
