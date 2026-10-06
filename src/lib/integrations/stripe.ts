// The customer's Stripe account beside a ticket: their subscriptions and
// latest payments, matched by email. For SaaS teams answering "why was I
// charged?" without opening Stripe.
//
// Teams paste a restricted key (rk_live_...) with read access to Customers,
// Subscriptions and Charges, so Flatdesk can't change anything in Stripe.
// This is the team's own Stripe account, not Flatdesk's billing (lib/billing.ts).

const API = "https://api.stripe.com/v1";
const TIMEOUT_MS = 5000;
// The version the stripe package in package.json uses for Flatdesk's own billing.
const STRIPE_VERSION = "2026-08-26.dahlia";

export class StripeLookupError extends Error {}

export type StripeCustomerView = {
  id: string;
  name: string | null;
  since: string;
  dashboardUrl: string;
  subscriptions: { plan: string; status: string; amount: string; renews: string | null; cancelAt: string | null }[];
  payments: { amount: string; status: string; date: string; refunded: boolean; description: string | null }[];
  others: number; // more Stripe customers with the same email
};

// Restricted keys only: a secret key can change everything in the account.
export function checkStripeKey(raw: string): { key: string } | { error: string } {
  const key = raw.trim();
  if (/^sk_(live|test)_/.test(key)) return { error: "That's a secret key, which can change anything in your Stripe account. Make a restricted key with read access instead." };
  if (!/^rk_(live|test)_[A-Za-z0-9]{10,}$/.test(key)) return { error: "Paste a restricted key. It starts with rk_live_." };
  return { key };
}

const testMode = (key: string) => key.startsWith("rk_test_");

export async function get<T>(key: string, path: string, fetcher: typeof fetch): Promise<T> {
  const res = await fetcher(`${API}${path}`, {
    headers: { authorization: `Bearer ${key}`, "stripe-version": STRIPE_VERSION },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401) throw new StripeLookupError("Stripe didn't accept the key. It may have been deleted or expired.");
  if (res.status === 403) throw new StripeLookupError("The Stripe key needs read access to Customers, Subscriptions and Charges.");
  if (!res.ok) throw new StripeLookupError(`Stripe answered ${res.status}.`);
  return (await res.json()) as T;
}

// Checks the key can read what the ticket panel needs; returns the account's name.
export async function verifyStripe(key: string, fetcher: typeof fetch = fetch): Promise<string> {
  await get(key, "/customers?limit=1", fetcher);
  await get(key, "/subscriptions?limit=1&status=all", fetcher);
  await get(key, "/charges?limit=1", fetcher);
  // Reading the account itself needs another permission; a name is nice but not needed.
  const account = await get<{ settings?: { dashboard?: { display_name?: string } }; business_profile?: { name?: string } }>(key, "/account", fetcher).catch(() => null);
  return account?.settings?.dashboard?.display_name || account?.business_profile?.name || (testMode(key) ? "Stripe (test mode)" : "Stripe");
}

export const money = (amount: number, currency: string) => {
  // Most currencies have cents; these don't (Stripe's list of zero-decimal currencies).
  const zero = ["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"].includes(currency.toLowerCase());
  return `${(zero ? amount : amount / 100).toFixed(zero ? 0 : 2)} ${currency.toUpperCase()}`;
};
const day = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

type Customer = { id: string; name: string | null; created: number };
type Subscription = {
  id: string;
  status: string;
  cancel_at_period_end?: boolean;
  cancel_at: number | null;
  current_period_end?: number; // where versions before 2025-03 put it
  items: { data: { current_period_end?: number; quantity?: number; price: { nickname: string | null; unit_amount: number | null; currency: string; recurring: { interval: string; interval_count: number } | null } }[] };
};
type Charge = { id: string; customer: string | null; amount: number; currency: string; status: string; created: number; refunded: boolean; amount_refunded: number; description: string | null };

export type { Subscription as StripeSubscription, Charge as StripeCharge };

export function subscriptionView(s: Subscription) {
  const item = s.items.data[0];
  const p = item?.price;
  const periodEnd = item?.current_period_end ?? s.current_period_end;
  const every = p?.recurring ? (p.recurring.interval_count > 1 ? `every ${p.recurring.interval_count} ${p.recurring.interval}s` : `a ${p.recurring.interval}`) : "";
  const amount = p?.unit_amount != null ? `${money(p.unit_amount * (item.quantity ?? 1), p.currency)} ${every}`.trim() : "Custom price";
  return {
    plan: p?.nickname || (item?.quantity && item.quantity > 1 ? `${item.quantity} seats` : "Subscription"),
    status: s.status.replace(/_/g, " "),
    amount,
    renews: periodEnd && !s.cancel_at && ["active", "trialing", "past_due"].includes(s.status) ? day(periodEnd) : null,
    cancelAt: s.cancel_at ? day(s.cancel_at) : null,
  };
}

export function chargeView(c: Charge) {
  const partly = !c.refunded && c.amount_refunded > 0;
  return {
    amount: money(c.amount, c.currency),
    status: c.refunded ? "refunded" : partly ? `${money(c.amount_refunded, c.currency)} refunded` : c.status,
    date: day(c.created),
    refunded: c.refunded || partly,
    description: c.description,
  };
}

export async function stripeCustomer(key: string, email: string, fetcher: typeof fetch = fetch): Promise<StripeCustomerView | null> {
  const found = await get<{ data: Customer[] }>(key, `/customers?limit=10&email=${encodeURIComponent(email)}`, fetcher);
  if (found.data.length === 0) return null;
  const c = found.data[0]; // Stripe lists the newest first
  const [subs, charges] = await Promise.all([
    get<{ data: Subscription[] }>(key, `/subscriptions?limit=3&status=all&customer=${c.id}`, fetcher),
    get<{ data: Charge[] }>(key, `/charges?limit=5&customer=${c.id}`, fetcher),
  ]);
  return {
    id: c.id,
    name: c.name,
    since: day(c.created),
    dashboardUrl: `https://dashboard.stripe.com/${testMode(key) ? "test/" : ""}customers/${c.id}`,
    subscriptions: subs.data.map(subscriptionView),
    payments: charges.data.map(chargeView),
    others: found.data.length - 1,
  };
}
