// Shopify orders beside a ticket: the customer's latest orders, matched by
// email, with payment and delivery status and tracking links.
//
// Two ways in, depending on when the store made its app:
// - Apps from Shopify's Dev Dashboard (the only kind since January 2026) give
//   a client ID and secret. Those buy a 24-hour access token with the client
//   credentials grant, which works because the app and store share an owner.
// - Custom apps made in the Shopify admin before 2026 give an Admin API access
//   token (shpat_...) that doesn't expire.
// Either way the app needs the read_orders and read_customers scopes. Orders
// older than 60 days also need read_all_orders.

export const SHOPIFY_API_VERSION = "2025-07";
const TIMEOUT_MS = 5000;

export type ShopifyCreds = { domain: string; token?: string; clientId?: string; clientSecret?: string };

export type ShopifyOrder = {
  id: string;
  name: string; // "#1042"
  createdAt: string;
  total: string; // "54.00 USD"
  paid: string; // "Paid", "Refunded", ...
  fulfillment: string; // "Fulfilled", "Unfulfilled", ...
  items: string[]; // "2 × Linen shirt"
  tracking: { number: string | null; url: string | null; company: string | null }[];
  adminUrl: string;
};

// "acme", "acme.myshopify.com" or "https://acme.myshopify.com/admin" all mean
// acme.myshopify.com. Only *.myshopify.com, since the server sends the
// token there.
export function shopDomain(raw: string): string | null {
  let s = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const admin = /^admin\.shopify\.com$/.test(s) ? /\/store\/([a-z0-9][a-z0-9-]*)/.exec(raw.toLowerCase()) : null;
  if (admin) s = admin[1];
  if (/^[a-z0-9][a-z0-9-]{0,60}$/.test(s)) s = `${s}.myshopify.com`;
  return /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/.test(s) ? s : null;
}

// Access tokens bought with the client credentials grant, kept until shortly
// before they expire. Per server instance, which is fine: a new one is cheap.
const tokens = new Map<string, { token: string; until: number }>();

export async function accessToken(c: ShopifyCreds, fetcher: typeof fetch): Promise<string> {
  if (c.token) return c.token;
  if (!c.clientId || !c.clientSecret) throw new ShopifyError("Add the app's client ID and secret.");
  const cacheKey = `${c.domain}:${c.clientId}`;
  const hit = tokens.get(cacheKey);
  if (hit && hit.until > Date.now()) return hit.token;
  const res = await fetcher(`https://${c.domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: c.clientId, client_secret: c.clientSecret }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new ShopifyError(
      res.status === 400 || res.status === 401
        ? "Shopify didn't accept the client ID and secret. Check they're from an app installed on this store, made by the same organization that owns it."
        : `Shopify answered ${res.status} when asked for an access token.`,
    );
  }
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new ShopifyError("Shopify didn't return an access token.");
  tokens.set(cacheKey, { token: body.access_token, until: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 300) * 1000 });
  return body.access_token;
}

export class ShopifyError extends Error {}

async function graphql<T>(c: ShopifyCreds, query: string, variables: Record<string, unknown>, fetcher: typeof fetch): Promise<T> {
  const res = await fetcher(`https://${c.domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-shopify-access-token": await accessToken(c, fetcher) },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401) throw new ShopifyError("Shopify didn't accept the access token. It may have been revoked.");
  if (res.status === 402 || res.status === 423) throw new ShopifyError("The Shopify store is frozen or locked.");
  if (res.status === 404) throw new ShopifyError("There's no Shopify store at that address.");
  if (!res.ok) throw new ShopifyError(`Shopify answered ${res.status}.`);
  const body = (await res.json()) as { data?: T; errors?: { message: string; extensions?: { code?: string } }[] };
  if (body.errors?.length) {
    const denied = body.errors.some((e) => e.extensions?.code === "ACCESS_DENIED");
    throw new ShopifyError(denied ? "The Shopify app needs the read_orders and read_customers scopes." : body.errors[0].message);
  }
  if (!body.data) throw new ShopifyError("Shopify returned nothing.");
  return body.data;
}

// Checks the credentials work, and returns the store's name.
export async function verifyShopify(c: ShopifyCreds, fetcher: typeof fetch = fetch): Promise<string> {
  const data = await graphql<{ shop: { name: string } }>(c, "{ shop { name } }", {}, fetcher);
  // Also read one order, so a missing read_orders scope shows up now, not on a ticket.
  await graphql(c, "{ orders(first: 1) { nodes { id } } }", {}, fetcher);
  return data.shop.name;
}

const ORDERS = `query Orders($q: String!) {
  orders(first: 5, query: $q, sortKey: CREATED_AT, reverse: true) {
    nodes {
      id name createdAt displayFinancialStatus displayFulfillmentStatus
      totalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 5) { nodes { title quantity } }
      fulfillments(first: 3) { trackingInfo(first: 2) { number url company } }
    }
  }
}`;

type RawOrder = {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  lineItems: { nodes: { title: string; quantity: number }[] };
  fulfillments: { trackingInfo: { number: string | null; url: string | null; company: string | null }[] }[];
};

// Shopify's search syntax: quotes and backslashes in the value would end it early.
export const orderQuery = (email: string) => `email:"${email.replace(/["\\]/g, "")}"`;

// "PARTIALLY_REFUNDED" -> "Partially refunded"
const words = (s: string | null) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ") : "Unknown");

export function toOrder(domain: string, o: RawOrder): ShopifyOrder {
  const store = domain.replace(/\.myshopify\.com$/, "");
  const numericId = o.id.split("/").pop();
  const amount = Number(o.totalPriceSet.shopMoney.amount);
  return {
    id: o.id,
    name: o.name,
    createdAt: o.createdAt,
    total: `${Number.isFinite(amount) ? amount.toFixed(2) : o.totalPriceSet.shopMoney.amount} ${o.totalPriceSet.shopMoney.currencyCode}`,
    paid: words(o.displayFinancialStatus),
    fulfillment: words(o.displayFulfillmentStatus),
    items: o.lineItems.nodes.map((i) => `${i.quantity} × ${i.title}`),
    tracking: o.fulfillments.flatMap((f) => f.trackingInfo).filter((t) => t.number || t.url),
    adminUrl: `https://admin.shopify.com/store/${store}/orders/${numericId}`,
  };
}

export async function shopifyOrders(c: ShopifyCreds, email: string, fetcher: typeof fetch = fetch): Promise<ShopifyOrder[]> {
  const data = await graphql<{ orders: { nodes: RawOrder[] } }>(c, ORDERS, { q: orderQuery(email) }, fetcher);
  return data.orders.nodes.map((o) => toOrder(c.domain, o));
}
