import { get, money, StripeLookupError, subscriptionView, type StripeCharge, type StripeSubscription } from "./stripe";
import { ShopifyError, SHOPIFY_API_VERSION, toOrder, type ShopifyCreds, type ShopifyOrder } from "./shopify";

// What the AI's built-in actions read and change in a team's own Stripe and
// Shopify (lib/ai-actions.ts). Every change is checked against the customer
// first: the payment, subscription or order must belong to the email on the
// ticket, so a customer can't talk the AI into acting on someone else's.

const STRIPE_API = "https://api.stripe.com/v1";
const STRIPE_VERSION = "2026-08-26.dahlia";
const TIMEOUT_MS = 10_000;

// Stripe amounts are in the currency's smallest unit, except these, which
// have none. Limits are set in dollars-and-cents, so these are scaled to match.
const ZERO_DECIMAL = ["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"];
export const minorUnits = (amount: number, currency: string) => (ZERO_DECIMAL.includes(currency.toLowerCase()) ? amount * 100 : amount);

// "12.50" in a currency -> Stripe's integer amount. null when it isn't a positive amount.
export function parseAmount(raw: string, currency: string): number | null {
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  const amount = ZERO_DECIMAL.includes(currency.toLowerCase()) ? Math.round(n) : Math.round(n * 100);
  return amount > 0 ? amount : null;
}

async function stripeCustomerIds(key: string, email: string, fetcher: typeof fetch): Promise<string[]> {
  const found = await get<{ data: { id: string }[] }>(key, `/customers?limit=10&email=${encodeURIComponent(email)}`, fetcher);
  return found.data.map((c) => c.id);
}

// The customer's Stripe records with ids, as the AI reads them.
export async function stripeRecords(key: string, email: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  const ids = await stripeCustomerIds(key, email, fetcher);
  if (ids.length === 0) return null;
  const lines: string[] = [];
  for (const id of ids.slice(0, 2)) {
    const [subs, charges] = await Promise.all([
      get<{ data: StripeSubscription[] }>(key, `/subscriptions?limit=3&status=all&customer=${id}`, fetcher),
      get<{ data: StripeCharge[] }>(key, `/charges?limit=5&customer=${id}`, fetcher),
    ]);
    for (const s of subs.data) {
      const v = subscriptionView(s);
      lines.push(`Subscription ${s.id}: ${v.plan}, ${v.amount}, ${v.status}${v.renews ? `, renews ${v.renews}` : ""}${v.cancelAt || s.cancel_at_period_end ? `, set to cancel${v.cancelAt ? ` on ${v.cancelAt}` : ""}` : ""}`);
    }
    for (const c of charges.data) {
      const refunded = c.amount_refunded > 0 ? `, ${money(c.amount_refunded, c.currency)} refunded` : "";
      lines.push(`Payment ${c.id}: ${money(c.amount, c.currency)}, ${c.status}${refunded}, ${new Date(c.created * 1000).toISOString().slice(0, 10)}${c.description ? `, "${c.description.slice(0, 100)}"` : ""}`);
    }
  }
  return lines.length ? lines.join("\n") : "A Stripe customer with no subscriptions or payments.";
}

async function stripePost<T>(key: string, path: string, form: Record<string, string>, idempotencyKey: string, fetcher: typeof fetch, needs: string): Promise<T> {
  const res = await fetcher(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "stripe-version": STRIPE_VERSION, "content-type": "application/x-www-form-urlencoded", "idempotency-key": idempotencyKey },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401) throw new StripeLookupError("Stripe didn't accept the key. It may have been deleted or expired.");
  if (res.status === 403) throw new StripeLookupError(`The Stripe key can't do this. In Stripe, give the Flatdesk key Write access to ${needs}.`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new StripeLookupError(body?.error?.message ? `Stripe said: ${body.error.message}` : `Stripe answered ${res.status}.`);
  }
  return (await res.json()) as T;
}

export type Checked = { summary: string; amountCents: number | null; run: (idempotencyKey: string) => Promise<string> } | { error: string };

export async function checkStripeRefund(key: string, email: string, input: { payment_id?: string; amount?: string }, fetcher: typeof fetch = fetch): Promise<Checked> {
  const id = (input.payment_id ?? "").trim();
  if (!/^(ch|py)_[A-Za-z0-9]+$/.test(id)) return { error: "Give the payment's id from the customer's records, like ch_..." };
  const [ids, charge] = await Promise.all([stripeCustomerIds(key, email, fetcher), get<StripeCharge>(key, `/charges/${id}`, fetcher).catch(() => null)]);
  if (!charge || !charge.customer || !ids.includes(charge.customer)) return { error: "That payment isn't one of this customer's." };
  if (charge.status !== "succeeded") return { error: `That payment ${charge.status === "pending" ? "is still pending" : "didn't go through"}, so there's nothing to refund.` };
  const left = charge.amount - charge.amount_refunded;
  if (left <= 0) return { error: "That payment is already fully refunded." };
  const raw = (input.amount ?? "").trim();
  const amount = raw ? parseAmount(raw, charge.currency) : left;
  if (amount === null) return { error: "The amount should be a number like 12.50, or empty for the full amount." };
  if (amount > left) return { error: `Only ${money(left, charge.currency)} of that payment can still be refunded.` };
  const day = new Date(charge.created * 1000).toISOString().slice(0, 10);
  const whole = amount === charge.amount;
  return {
    summary: `Refund ${money(amount, charge.currency)}${whole ? "" : ` of the ${money(charge.amount, charge.currency)}`} payment from ${day} in Stripe`,
    amountCents: minorUnits(amount, charge.currency),
    run: async (idem) => {
      const refund = await stripePost<{ id: string; status: string }>(key, "/refunds", { charge: charge.id, amount: String(amount), "metadata[source]": "flatdesk" }, idem, fetcher, "Refunds");
      return `Refund ${refund.id} is ${refund.status}.`;
    },
  };
}

export async function checkStripeCancel(key: string, email: string, input: { subscription_id?: string }, fetcher: typeof fetch = fetch): Promise<Checked> {
  const id = (input.subscription_id ?? "").trim();
  if (!/^sub_[A-Za-z0-9]+$/.test(id)) return { error: "Give the subscription's id from the customer's records, like sub_..." };
  const [ids, sub] = await Promise.all([
    stripeCustomerIds(key, email, fetcher),
    get<StripeSubscription & { customer: string }>(key, `/subscriptions/${id}`, fetcher).catch(() => null),
  ]);
  if (!sub || !ids.includes(sub.customer)) return { error: "That subscription isn't one of this customer's." };
  if (!["active", "trialing", "past_due"].includes(sub.status)) return { error: `That subscription is already ${sub.status.replace(/_/g, " ")}.` };
  if (sub.cancel_at_period_end || sub.cancel_at) return { error: "That subscription is already set to cancel." };
  const v = subscriptionView(sub);
  return {
    summary: `Cancel the ${v.plan} subscription (${v.amount}) in Stripe at the end of the paid period${v.renews ? `, ${v.renews}` : ""}`,
    amountCents: null,
    run: async (idem) => {
      await stripePost(key, `/subscriptions/${sub.id}`, { cancel_at_period_end: "true" }, idem, fetcher, "Subscriptions");
      return `Set to cancel at the end of the period${v.renews ? ` (${v.renews})` : ""}.`;
    },
  };
}

async function shopifyGraphql<T>(c: ShopifyCreds, token: string, query: string, variables: Record<string, unknown>, fetcher: typeof fetch): Promise<T> {
  const res = await fetcher(`https://${c.domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-shopify-access-token": token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401) throw new ShopifyError("Shopify didn't accept the access token. It may have been revoked.");
  if (!res.ok) throw new ShopifyError(`Shopify answered ${res.status}.`);
  const body = (await res.json()) as { data?: T; errors?: { message: string; extensions?: { code?: string } }[] };
  if (body.errors?.length) {
    const denied = body.errors.some((e) => e.extensions?.code === "ACCESS_DENIED");
    throw new ShopifyError(denied ? "The Shopify app needs the write_orders scope to cancel orders." : body.errors[0].message);
  }
  if (!body.data) throw new ShopifyError("Shopify returned nothing.");
  return body.data;
}

const ORDER = `query Order($id: ID!) {
  order(id: $id) {
    id name createdAt email cancelledAt displayFinancialStatus displayFulfillmentStatus
    totalPriceSet { shopMoney { amount currencyCode } }
    lineItems(first: 5) { nodes { title quantity } }
    fulfillments(first: 3) { trackingInfo(first: 2) { number url company } }
  }
}`;

const CANCEL = `mutation Cancel($id: ID!) {
  orderCancel(orderId: $id, reason: CUSTOMER, refund: true, restock: true, notifyCustomer: false, staffNote: "Cancelled by the Flatdesk AI at the customer's request") {
    job { id }
    orderCancelUserErrors { message }
  }
}`;

// Cancels an order that hasn't shipped, refunding it to the original payment
// and restocking the items. getToken buys or reuses the store's access token.
export async function checkShopifyCancel(c: ShopifyCreds, getToken: () => Promise<string>, email: string, input: { order_id?: string }, fetcher: typeof fetch = fetch): Promise<Checked> {
  const raw = (input.order_id ?? "").trim();
  const id = /^\d+$/.test(raw) ? `gid://shopify/Order/${raw}` : raw;
  if (!/^gid:\/\/shopify\/Order\/\d+$/.test(id)) return { error: "Give the order's id from the customer's records, like gid://shopify/Order/123." };
  const token = await getToken();
  const data = await shopifyGraphql<{ order: (Parameters<typeof toOrder>[1] & { email: string | null; cancelledAt: string | null }) | null }>(c, token, ORDER, { id }, fetcher);
  const o = data.order;
  if (!o || (o.email ?? "").toLowerCase() !== email.toLowerCase()) return { error: "That order isn't one of this customer's." };
  if (o.cancelledAt) return { error: "That order is already cancelled." };
  const view: ShopifyOrder = toOrder(c.domain, o);
  if (!["Unfulfilled", "Scheduled", "On hold"].includes(view.fulfillment)) return { error: `That order is ${view.fulfillment.toLowerCase()}, so it can't be cancelled here.` };
  const amount = Math.round(Number(o.totalPriceSet.shopMoney.amount) * 100);
  return {
    summary: `Cancel Shopify order ${o.name} (${view.total}), refund it and restock the items`,
    amountCents: Number.isFinite(amount) ? amount : null,
    run: async () => {
      const out = await shopifyGraphql<{ orderCancel: { orderCancelUserErrors: { message: string }[] } }>(c, token, CANCEL, { id }, fetcher);
      const err = out.orderCancel.orderCancelUserErrors[0];
      if (err) throw new ShopifyError(`Shopify said: ${err.message}`);
      return `Order ${o.name} is being cancelled and refunded.`;
    },
  };
}

// The customer's orders, as the AI reads them.
export function shopifyRecords(orders: ShopifyOrder[]): string {
  if (orders.length === 0) return "No orders for this email.";
  return orders
    .map((o) => {
      const track = o.tracking.map((t) => [t.company, t.number, t.url].filter(Boolean).join(" ")).join("; ");
      return `Order ${o.name} (id ${o.id}), ${o.createdAt.slice(0, 10)}: ${o.total}, ${o.paid.toLowerCase()}, ${o.fulfillment.toLowerCase()}. Items: ${o.items.join(", ")}.${track ? ` Tracking: ${track}.` : ""}`;
    })
    .join("\n");
}
