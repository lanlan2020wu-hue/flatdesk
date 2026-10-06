// The REST API, API keys and the Shopify, Stripe, HubSpot and Jira lookups
// (with their HTTP calls faked). Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq, like } from "drizzle-orm";

const ORG = "org_test_integrations";
const OTHER = "org_test_integrations_other";

after(async () => {
  const { pool } = await import("@/db");
  await pool.end();
});

async function freshOrgs() {
  const { db, schema } = await import("@/db");
  for (const id of [ORG, OTHER]) {
    await db.delete(schema.orgs).where(eq(schema.orgs.id, id));
    await db.insert(schema.orgs).values({ id, name: id === ORG ? "Acme Support" : "Other team", aiEnabled: false });
  }
  await db.insert(schema.agents).values([
    { orgId: ORG, userId: "user_admin", name: "Ada Admin", email: "ada@acme.test", role: "admin" },
    { orgId: ORG, userId: "user_sam", name: "Sam Agent", email: "Sam@acme.test", role: "agent" },
    { orgId: ORG, userId: "user_vic", name: "Vic Viewer", email: "vic@acme.test", role: "agent", viewer: true },
  ]);
  await db.delete(schema.rateLimits).where(like(schema.rateLimits.key, "api:%"));
}

const params = <T,>(p: T) => ({ params: Promise.resolve(p) }) as never;
const req = (path: string, key: string | null, init: { method?: string; body?: unknown } = {}) =>
  new Request(`http://x${path}`, {
    method: init.method ?? "GET",
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json" },
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });

test("API keys: shown once, stored hashed, scoped to their team, revocable", async () => {
  await freshOrgs();
  const { db, schema } = await import("@/db");
  const { createApiKey, hashKey, listApiKeys, revokeApiKey, authenticate } = await import("./api-keys");
  const made = await createApiKey(ORG, "user_admin", "Zapier");
  assert.ok("key" in made && made.key.startsWith("fd_"));
  const [row] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.orgId, ORG));
  assert.equal(row.hash, hashKey(made.key));
  assert.ok(!JSON.stringify(row).includes(made.key), "the key itself isn't stored");
  assert.equal(row.prefix, made.key.slice(0, 11));

  const caller = await authenticate(req("/api/v1/me", made.key));
  assert.equal(caller?.orgId, ORG);
  assert.equal(await authenticate(req("/api/v1/me", "fd_" + "x".repeat(43))), null);
  assert.equal(await authenticate(req("/api/v1/me", null)), null);

  await revokeApiKey(OTHER, row.id); // another team can't revoke it
  assert.ok(await authenticate(req("/api/v1/me", made.key)));
  await revokeApiKey(ORG, row.id);
  assert.equal(await authenticate(req("/api/v1/me", made.key)), null);
  assert.equal((await listApiKeys(ORG)).length, 0);
});

test("REST API: list, read, update, reply and look up customers, only within the key's team", async () => {
  await freshOrgs();
  const { db, schema } = await import("@/db");
  const { createApiKey } = await import("./api-keys");
  const { createTicket } = await import("./tickets");
  const made = await createApiKey(ORG, "user_admin", "Script");
  assert.ok("key" in made);
  const key = made.key;
  const t1 = await createTicket({ orgId: ORG, channel: "email", customerEmail: "kim@example.com", customerName: "Kim", subject: "Refund please", body: "I want a refund", authorType: "customer", tags: ["billing"] });
  await createTicket({ orgId: ORG, channel: "chat", customerEmail: "lee@example.com", subject: "Login broken", body: "Can't log in", authorType: "customer" });
  const theirs = await createTicket({ orgId: OTHER, channel: "email", customerEmail: "kim@example.com", subject: "Not yours", body: "secret", authorType: "customer" });

  const me = (await import("@/app/api/v1/me/route")).GET;
  assert.equal((await me(req("/api/v1/me", null))).status, 401);
  assert.deepEqual(await (await me(req("/api/v1/me", key))).json(), { team: "Acme Support", key: "Script", locked: false });

  const list = (await import("@/app/api/v1/tickets/route")).GET;
  const all = await (await list(req("/api/v1/tickets", key))).json();
  assert.equal(all.tickets.length, 2, "only this team's tickets");
  const billing = await (await list(req("/api/v1/tickets?tag=billing", key))).json();
  assert.deepEqual(billing.tickets.map((t: { number: number }) => t.number), [t1.number]);
  const byCustomer = await (await list(req("/api/v1/tickets?customer_email=KIM@example.com", key))).json();
  assert.equal(byCustomer.tickets.length, 1);
  assert.equal((await list(req("/api/v1/tickets?updated_since=not-a-date", key))).status, 400);
  const later = await (await list(req(`/api/v1/tickets?updated_since=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`, key))).json();
  assert.equal(later.tickets.length, 0);

  const one = (await import("@/app/api/v1/tickets/[number]/route"));
  const got = await (await one.GET(req(`/api/v1/tickets/${t1.number}`, key), params({ number: String(t1.number) }))).json();
  assert.equal(got.ticket.subject, "Refund please");
  assert.equal(got.ticket.customer.email, "kim@example.com");
  assert.equal(got.ticket.messages[0].body, "I want a refund");
  assert.equal((await one.GET(req(`/api/v1/tickets/${theirs.number + 1000}`, key), params({ number: String(theirs.number + 1000) }))).status, 404);
  assert.equal((await one.GET(req("/api/v1/tickets/abc", key), params({ number: "abc" }))).status, 404);

  // Assign by email (case-insensitive), add a tag, close.
  const patched = await one.PATCH(
    req(`/api/v1/tickets/${t1.number}`, key, { method: "PATCH", body: { assignee_email: "sam@acme.test", add_tags: ["Refunded"], status: "closed" } }),
    params({ number: String(t1.number) }),
  );
  assert.equal(patched.status, 200);
  const p = (await patched.json()).ticket;
  assert.equal(p.status, "closed");
  assert.deepEqual(p.tags, ["billing", "refunded"]);
  assert.equal(p.assignee.name, "Sam Agent");
  const bad = async (body: unknown) => (await one.PATCH(req(`/api/v1/tickets/${t1.number}`, key, { method: "PATCH", body }), params({ number: String(t1.number) }))).status;
  assert.equal(await bad({ assignee_email: "vic@acme.test" }), 400, "viewers can't be assigned");
  assert.equal(await bad({ assignee_email: "nobody@acme.test" }), 400);
  assert.equal(await bad({ status: "solved" }), 400);
  assert.equal(await bad({}), 400);
  assert.equal(await bad("{not json"), 400);

  // A reply is signed by the key's maker unless another agent is named, and sets pending.
  const messages = (await import("@/app/api/v1/tickets/[number]/messages/route")).POST;
  const replied = await messages(req(`/api/v1/tickets/${t1.number}/messages`, key, { method: "POST", body: { body: "Refund sent." } }), params({ number: String(t1.number) }));
  assert.equal(replied.status, 201);
  const r = (await replied.json()).ticket;
  assert.equal(r.status, "pending");
  assert.equal(r.messages.at(-1).author_name, "Ada Admin");
  assert.ok(r.first_response_at);
  const noted = await messages(
    req(`/api/v1/tickets/${t1.number}/messages`, key, { method: "POST", body: { body: "Checked in Stripe", internal: true, author_email: "sam@acme.test" } }),
    params({ number: String(t1.number) }),
  );
  const n = (await noted.json()).ticket;
  assert.equal(n.status, "pending", "a note leaves the status alone");
  assert.deepEqual([n.messages.at(-1).internal, n.messages.at(-1).author_name], [true, "Sam Agent"]);
  assert.equal((await messages(req(`/api/v1/tickets/${t1.number}/messages`, key, { method: "POST", body: {} }), params({ number: String(t1.number) }))).status, 400);

  const customers = (await import("@/app/api/v1/customers/route")).GET;
  const kim = await (await customers(req("/api/v1/customers?email=kim@example.com", key))).json();
  assert.equal(kim.customer.tickets.length, 1, "not the other team's ticket for the same email");
  assert.equal((await customers(req("/api/v1/customers?email=nobody@example.com", key))).status, 404);

  // A team whose trial ended without a card can read but not write.
  process.env.STRIPE_SECRET_KEY ??= "sk_test_dummy";
  await db.update(schema.orgs).set({ createdAt: new Date(Date.now() - 90 * 86_400_000) }).where(eq(schema.orgs.id, ORG));
  const { access } = await import("./billing");
  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, ORG) });
  assert.equal(access(org!).state, "locked");
  assert.equal((await list(req("/api/v1/tickets", key))).status, 200);
  assert.equal(await bad({ status: "open" }), 402);
});

test("Shopify: store addresses, order query and order shape", async () => {
  const { shopDomain, orderQuery, shopifyOrders, verifyShopify } = await import("./integrations/shopify");
  assert.equal(shopDomain("acme"), "acme.myshopify.com");
  assert.equal(shopDomain("https://Acme.myshopify.com/admin/orders"), "acme.myshopify.com");
  assert.equal(shopDomain("https://admin.shopify.com/store/acme-co/orders"), "acme-co.myshopify.com");
  assert.equal(shopDomain("evil.com"), null);
  assert.equal(shopDomain("acme.myshopify.com.evil.com"), null);
  assert.equal(shopDomain("169.254.169.254"), null);
  assert.equal(orderQuery('a"b\\@x.com'), 'email:"ab@x.com"');

  const calls: string[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method} ${url}`);
    if (url.endsWith("/admin/oauth/access_token")) {
      assert.match(String(init?.body), /grant_type=client_credentials/);
      return Response.json({ access_token: "tok_1", expires_in: 86399 });
    }
    assert.equal((init?.headers as Record<string, string>)["x-shopify-access-token"], "tok_1");
    const q = JSON.parse(String(init?.body)).query as string;
    if (q.includes("shop {")) return Response.json({ data: { shop: { name: "Acme Store" } } });
    if (q.includes("orders(first: 1)")) return Response.json({ data: { orders: { nodes: [] } } });
    return Response.json({
      data: {
        orders: {
          nodes: [
            {
              id: "gid://shopify/Order/555",
              name: "#1042",
              createdAt: "2026-10-01T10:00:00Z",
              displayFinancialStatus: "PARTIALLY_REFUNDED",
              displayFulfillmentStatus: "FULFILLED",
              totalPriceSet: { shopMoney: { amount: "54.5", currencyCode: "USD" } },
              lineItems: { nodes: [{ title: "Linen shirt", quantity: 2 }] },
              fulfillments: [{ trackingInfo: [{ number: "1Z999", url: "https://ups.example/1Z999", company: "UPS" }] }],
            },
          ],
        },
      },
    });
  }) as typeof fetch;
  const creds = { domain: "acme.myshopify.com", clientId: "id", clientSecret: "secret" };
  assert.equal(await verifyShopify(creds, fake), "Acme Store");
  const [o] = await shopifyOrders(creds, "kim@example.com", fake);
  assert.deepEqual(
    { name: o.name, total: o.total, paid: o.paid, fulfillment: o.fulfillment, items: o.items, tracking: o.tracking[0].number, adminUrl: o.adminUrl },
    { name: "#1042", total: "54.50 USD", paid: "Partially refunded", fulfillment: "Fulfilled", items: ["2 × Linen shirt"], tracking: "1Z999", adminUrl: "https://admin.shopify.com/store/acme/orders/555" },
  );
  assert.equal(calls.filter((c) => c.includes("access_token")).length, 1, "the access token is reused until it expires");

  const denied = (async () => Response.json({ errors: [{ message: "Access denied", extensions: { code: "ACCESS_DENIED" } }] })) as unknown as typeof fetch;
  await assert.rejects(verifyShopify({ domain: "acme.myshopify.com", token: "shpat_x" }, denied), /read_orders/);
});

test("Stripe: restricted keys only, and payments and plans in words", async () => {
  const { checkStripeKey, stripeCustomer, subscriptionView, chargeView, money } = await import("./integrations/stripe");
  assert.ok("error" in checkStripeKey("sk_live_abcdefghijklmnop"));
  assert.ok("error" in checkStripeKey("pk_live_abc"));
  assert.ok("key" in checkStripeKey(" rk_live_abcdefghijklmnop "));
  assert.equal(money(4900, "usd"), "49.00 USD");
  assert.equal(money(500, "jpy"), "500 JPY");
  assert.equal(chargeView({ id: "ch_1", customer: "cus_1", amount: 4900, currency: "usd", status: "succeeded", created: 1_790_000_000, refunded: false, amount_refunded: 1000, description: null }).status, "10.00 USD refunded");
  const sub = subscriptionView({
    id: "sub_1",
    status: "active",
    cancel_at: null,
    items: { data: [{ current_period_end: 1_790_000_000, quantity: 3, price: { nickname: "Team", unit_amount: 1500, currency: "usd", recurring: { interval: "month", interval_count: 1 } } }] },
  });
  assert.deepEqual([sub.plan, sub.amount, sub.status], ["Team", "45.00 USD a month", "active"]);
  assert.ok(sub.renews);

  const fake = (async (url: string) => {
    if (url.includes("/customers?")) return Response.json({ data: [{ id: "cus_1", name: "Kim", created: 1_700_000_000 }] });
    if (url.includes("/subscriptions?")) return Response.json({ data: [] });
    if (url.includes("/charges?")) return Response.json({ data: [{ amount: 4900, currency: "usd", status: "failed", created: 1_790_000_000, refunded: false, amount_refunded: 0, description: null }] });
    throw new Error(url);
  }) as typeof fetch;
  const c = await stripeCustomer("rk_test_abcdefghijklmnop", "kim@example.com", fake);
  assert.equal(c?.dashboardUrl, "https://dashboard.stripe.com/test/customers/cus_1");
  assert.equal(c?.payments[0].status, "failed");
  const none = (async () => Response.json({ data: [] })) as unknown as typeof fetch;
  assert.equal(await stripeCustomer("rk_live_abcdefghijklmnop", "x@example.com", none), null);
});

test("HubSpot: token check and the contact in words", async () => {
  const { checkHubSpotToken, hubspotContact } = await import("./integrations/hubspot");
  assert.ok("error" in checkHubSpotToken("abc"));
  assert.ok("token" in checkHubSpotToken(["pat", "na1", "0".repeat(8), "0".repeat(4), "0".repeat(4), "0".repeat(4), "0".repeat(12)].join("-")));
  const fake = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/crm/v3/objects/contacts/search")) {
      assert.equal(JSON.parse(String(init?.body)).filterGroups[0].filters[0].value, "kim@example.com");
      return Response.json({ results: [{ id: "77", properties: { firstname: "Kim", lastname: "Lee", lifecyclestage: "salesqualifiedlead", associatedcompanyid: "9", hubspot_owner_id: "5" } }] });
    }
    if (url.includes("/companies/9")) return Response.json({ properties: { name: "Kim Co" } });
    if (url.includes("/owners/5")) return new Response("", { status: 403 }); // no owners scope
    throw new Error(url);
  }) as typeof fetch;
  const c = await hubspotContact({ token: "pat-na1-x", portalId: "123", uiDomain: "app-eu1.hubspot.com" }, "kim@example.com", fake);
  assert.deepEqual([c?.name, c?.company, c?.stage, c?.owner, c?.url], ["Kim Lee", "Kim Co", "Sales qualified lead", null, "https://app-eu1.hubspot.com/contacts/123/record/0-1/77"]);
});

test("Jira: sites, project keys, issue body, and escalating a ticket links it", async () => {
  await freshOrgs();
  const { jiraSite, projectKey, description } = await import("./integrations/jira");
  assert.equal(jiraSite("acme"), "acme.atlassian.net");
  assert.equal(jiraSite("https://acme.atlassian.net/jira/software"), "acme.atlassian.net");
  assert.equal(jiraSite("acme.atlassian.net.evil.com"), null);
  assert.equal(projectKey(" sup "), "SUP");
  assert.equal(projectKey("1AB"), null);
  const doc = description("Steps\n\nMore", "https://flatdesk.app/app/tickets/4", "ticket #4");
  assert.equal(doc.content.length, 3);

  const { connectJira, escalateToJira, jiraForTicket } = await import("./integrations");
  const { createTicket } = await import("./tickets");
  const created: unknown[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    assert.ok(url.startsWith("https://acme.atlassian.net/"));
    assert.match((init?.headers as Record<string, string>).authorization, /^Basic /);
    if (url.endsWith("/myself")) return Response.json({ accountId: "a" });
    if (url.endsWith("/project/SUP")) return Response.json({ key: "SUP", name: "Support", issueTypes: [{ name: "Bug" }, { name: "Task" }, { name: "Sub-task", subtask: true }] });
    if (url.endsWith("/rest/api/3/issue")) {
      created.push(JSON.parse(String(init?.body)));
      return Response.json({ key: "SUP-12" });
    }
    if (url.includes("/issue/SUP-12")) return Response.json({ key: "SUP-12", fields: { summary: "Login broken", status: { name: "Done", statusCategory: { key: "done" } } } });
    throw new Error(url);
  }) as typeof fetch;

  const wrongType = await connectJira(ORG, "user_admin", { site: "acme", email: "s@acme.test", token: "t", project: "sup", issueType: "Story" }, fake);
  assert.ok("error" in wrongType && /Bug, Task/.test(wrongType.error));
  const ok = await connectJira(ORG, "user_admin", { site: "acme", email: "s@acme.test", token: "t", project: "sup", issueType: "bug" }, fake);
  assert.ok("ok" in ok);

  const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: "lee@example.com", subject: "Login broken", body: "Can't log in", authorType: "customer" });
  assert.deepEqual(await jiraForTicket(ORG, t.id, fake), { state: "ok", data: [] });
  const issue = await escalateToJira(ORG, "user_sam", t, { summary: "Login broken", body: "Can't log in", ticketUrl: "https://flatdesk.app/app/tickets/1" }, fake);
  assert.deepEqual(issue, { key: "SUP-12", url: "https://acme.atlassian.net/browse/SUP-12" });
  assert.equal((created[0] as { fields: { issuetype: { name: string } } }).fields.issuetype.name, "Bug", "uses Jira's spelling of the type");
  const linked = await jiraForTicket(ORG, t.id, fake);
  assert.ok(linked.state === "ok" && linked.data[0].done && linked.data[0].status === "Done");

  // Credentials are stored sealed, not as typed.
  const { db, schema } = await import("@/db");
  const [row] = await db.select().from(schema.integrations).where(eq(schema.integrations.orgId, ORG));
  assert.ok(!row.credentials.includes("s@acme.test"));
});
