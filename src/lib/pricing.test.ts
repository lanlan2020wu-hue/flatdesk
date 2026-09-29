// Prices and the yearly plan. Billing runs against a small fake Stripe. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { RIVALS } from "./compare";
import { ATTEMPTS_PER_INCLUDED, callCost } from "./ai";
import { COMPETITORS, PLAN, competitorById, competitorMonthly, flatdeskMonthly, seatInvoiceAmount } from "./pricing";

test("every plan a comparison page names exists, so none falls back to another vendor's prices", () => {
  const ids = new Set(COMPETITORS.map((c) => c.id));
  for (const r of RIVALS) for (const id of r.plans) assert.ok(ids.has(id), `${r.slug} names unknown plan ${id}`);
});

test("Freshdesk's 500 AI sessions are one-time, so a steady month pays for every session", () => {
  const growth = competitorById("freshdesk-growth");
  assert.equal(growth.id, "freshdesk-growth");
  assert.equal(competitorMonthly(growth, 3, 150).total, 3 * 19 + 150 * 0.49);
  // The compare page's teams: Flatdesk yearly wins both, and the stated break-even holds.
  assert.ok(flatdeskMonthly(3, 150, "year").capped < competitorMonthly(growth, 3, 150).total);
  assert.ok(flatdeskMonthly(10, 800, "year").capped < competitorMonthly(growth, 10, 800).total);
  const breakEven = (PLAN.annualSeatPrice - growth.seatPrice) / growth.aiRate;
  assert.equal(Math.round(breakEven), 41);
});

test("yearly billing is cheaper and still makes money on a seat that uses its whole AI allowance", () => {
  assert.ok(PLAN.annualSeatPrice < PLAN.seatPrice);
  assert.equal(seatInvoiceAmount("year"), PLAN.annualSeatPrice * 12);
  assert.equal(flatdeskMonthly(10, 800, "year").seats, 10 * PLAN.annualSeatPrice);
  // One call at the full knowledge size (100 saved answers ≈ 15k tokens, all
  // read from or written to the cache), a 600-token email and 1.2k tokens out, priced by ai.ts.
  // Handoffs and answers customers replied to cost a call without counting, so
  // assume 2 calls per counted resolution; ATTEMPTS_PER_INCLUDED caps the worst case.
  const cold = callCost({ input_tokens: 600, cache_creation_input_tokens: 15_350, output_tokens: 1_200 });
  const warm = callCost({ input_tokens: 600, cache_read_input_tokens: 15_350, output_tokens: 1_200 });
  const perCall = (cold + warm) / 2; // half the calls find the hour-long cache warm
  const aiCost = PLAN.includedPerAgent * perCall * 2;
  const worstCase = PLAN.includedPerAgent * cold * ATTEMPTS_PER_INCLUDED; // every call cold, every attempt used
  const stripeFee = PLAN.annualSeatPrice * 0.036 + 0.3 / 12;
  assert.ok(PLAN.annualSeatPrice - aiCost - stripeFee > 10, "at least $10 a seat a month left at the typical handoff rate");
  assert.ok(PLAN.seatPrice - worstCase - PLAN.seatPrice * 0.036 > 0, "a monthly seat never loses money, even at the attempt cap");
  assert.ok(PLAN.overageRate > perCall * 2 * 1.2, "overage covers its AI cost with room to spare");
});

// A fake Stripe that records every request and keeps one subscription.
type Call = { method: string; path: string; body: URLSearchParams };
const calls: Call[] = [];
const invoiceItems: { id: string; object: string; metadata: Record<string, string | null> }[] = [];
const sub = { exists: false, interval: "month" as "month" | "year", quantity: 2 };
const subscription = () => ({
  id: "sub_1",
  object: "subscription",
  status: "active",
  items: {
    object: "list",
    data: [{ id: "si_1", quantity: sub.quantity, current_period_end: 1_900_000_000, price: { id: "price_1", product: "prod_1", recurring: { interval: sub.interval } } }],
  },
});
const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const url = new URL(req.url ?? "/", "http://x");
    const body = new URLSearchParams(req.method === "GET" ? url.search : raw);
    calls.push({ method: req.method ?? "", path: url.pathname, body });
    const send = (o: unknown) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(o));
    };
    const p = url.pathname;
    if (p === "/v1/customers") return send({ id: "cus_1", object: "customer" });
    if (p === "/v1/customers/cus_1") return send({ id: "cus_1", object: "customer" });
    if (p === "/v1/checkout/sessions") return send({ id: "cs_1", object: "checkout.session", url: "https://checkout.test/cs_1" });
    if (p === "/v1/subscriptions") return send({ object: "list", data: sub.exists ? [subscription()] : [], has_more: false });
    if (p === "/v1/subscriptions/sub_1") {
      if (req.method === "POST" && body.get("items[0][price_data][recurring][interval]") === "year") sub.interval = "year";
      return send(subscription());
    }
    if (p === "/v1/subscription_items/si_1") return send({ id: "si_1", object: "subscription_item" });
    if (p === "/v1/invoiceitems" && req.method === "GET") return send({ object: "list", data: invoiceItems, has_more: false });
    if (p === "/v1/invoiceitems") {
      invoiceItems.push({ id: `ii_${invoiceItems.length + 1}`, object: "invoiceitem", metadata: { overageMonth: body.get("metadata[overageMonth]") } });
      return send(invoiceItems.at(-1));
    }
    if (p === "/v1/billing_portal/sessions") return send({ id: "bps_1", object: "billing_portal.session", url: "https://portal.test/bps_1" });
    if (p === "/v1/invoices") return send({ id: "in_1", object: "invoice" });
    res.statusCode = 404;
    send({ error: { type: "invalid_request_error", message: `fake Stripe has no ${p}` } });
  });
});

const ORG = "org_test_yearly";
const posts = (path: string) => calls.filter((c) => c.method === "POST" && c.path === path);

before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  process.env.STRIPE_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.close();
  const { pool } = await import("@/db");
  await pool.end();
});

test("yearly checkout charges 12 months up front; switching, seat changes and overage bill without waiting a year", async () => {
  const { db, schema } = await import("@/db");
  const { billOverage, checkoutUrl, refreshSubscription, switchToAnnual, syncSeats } = await import("./billing");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Yearly team" });
  await db.insert(schema.agents).values([
    { orgId: ORG, userId: "user_y1", name: "A", email: "a@yearly.dev", role: "admin" },
    { orgId: ORG, userId: "user_y2", name: "B", email: "b@yearly.dev", role: "agent" },
  ]);

  // Checkout: the yearly price is the monthly-equivalent × 12, on a yearly interval.
  assert.equal(await checkoutUrl(ORG, "a@yearly.dev", "https://app.test", "year"), "https://checkout.test/cs_1");
  const yearly = posts("/v1/checkout/sessions").at(-1)!.body;
  assert.equal(yearly.get("line_items[0][price_data][unit_amount]"), String(PLAN.annualSeatPrice * 12 * 100));
  assert.equal(yearly.get("line_items[0][price_data][recurring][interval]"), "year");
  assert.equal(yearly.get("line_items[0][quantity]"), "2");
  await checkoutUrl(ORG, "a@yearly.dev", "https://app.test");
  const monthly = posts("/v1/checkout/sessions").at(-1)!.body;
  assert.equal(monthly.get("line_items[0][price_data][unit_amount]"), String(PLAN.seatPrice * 100));
  assert.equal(monthly.get("line_items[0][price_data][recurring][interval]"), "month");

  // Once a plan exists, Checkout sends the admin to the portal instead of starting a second subscription.
  sub.exists = true;
  assert.equal(await checkoutUrl(ORG, "a@yearly.dev", "https://app.test"), "https://portal.test/bps_1");

  // A monthly plan: refresh records the interval, and a new seat waits for the next invoice.
  let org = await refreshSubscription(ORG);
  assert.deepEqual([org.billingInterval, org.billedSeats], ["month", 2]);
  await db.insert(schema.agents).values({ orgId: ORG, userId: "user_y3", name: "C", email: "c@yearly.dev", role: "agent" });
  await syncSeats(ORG);
  assert.equal(posts("/v1/subscription_items/si_1").at(-1)!.body.get("proration_behavior"), "create_prorations");

  // Switching to yearly swaps in the yearly price on the same product and invoices now.
  sub.quantity = 3;
  org = await switchToAnnual(ORG);
  const sw = posts("/v1/subscriptions/sub_1").at(-1)!.body;
  assert.equal(sw.get("items[0][price_data][unit_amount]"), String(PLAN.annualSeatPrice * 12 * 100));
  assert.equal(sw.get("items[0][price_data][product]"), "prod_1");
  assert.equal(sw.get("proration_behavior"), "always_invoice");
  assert.equal(org.billingInterval, "year");

  // On yearly billing a new seat is invoiced straight away.
  await db.insert(schema.agents).values({ orgId: ORG, userId: "user_y4", name: "D", email: "d@yearly.dev", role: "agent" });
  await syncSeats(ORG);
  assert.equal(posts("/v1/subscription_items/si_1").at(-1)!.body.get("proration_behavior"), "always_invoice");

  // A removed yearly seat isn't refunded mid-year.
  await db.delete(schema.agents).where(eq(schema.agents.userId, "user_y4"));
  sub.quantity = 4;
  await syncSeats(ORG);
  assert.equal(posts("/v1/subscription_items/si_1").at(-1)!.body.get("proration_behavior"), "none");

  // Overage gets its own invoice instead of waiting for the renewal. Only what
  // the month ended over the allowance is billed: 3 seats include 300, and 7
  // answers ran as overage, but 2 earlier ones stopped counting when customers replied.
  const included = 3 * PLAN.includedPerAgent;
  await db.insert(schema.aiEvents).values([
    ...Array.from({ length: included - 2 }, () => ({ orgId: ORG, kind: "resolution" as const, month: "2026-08", model: "test" })),
    ...Array.from({ length: 7 }, () => ({ orgId: ORG, kind: "resolution" as const, month: "2026-08", overage: true, model: "test" })),
  ]);
  assert.equal(await billOverage(ORG, "2026-08"), 5);
  assert.equal(posts("/v1/invoiceitems").at(-1)!.body.get("amount"), String(Math.round(5 * PLAN.overageRate * 100)));
  const invoice = posts("/v1/invoices").at(-1)!.body;
  assert.equal(invoice.get("pending_invoice_items_behavior"), "include");
  assert.equal(invoice.get("customer"), "cus_1");
  assert.equal(await billOverage(ORG, "2026-08"), null, "billed once");

  // A run that charged but died before recording it doesn't charge again.
  await db.update(schema.orgs).set({ overageBilledMonth: "2026-07" }).where(eq(schema.orgs.id, ORG));
  const before = posts("/v1/invoiceitems").length;
  assert.equal(await billOverage(ORG, "2026-08"), 5);
  assert.equal(posts("/v1/invoiceitems").length, before, "no second invoice item");
});
