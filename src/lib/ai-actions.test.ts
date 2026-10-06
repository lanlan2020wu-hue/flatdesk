// AI actions: approval rules, ownership checks on Stripe and Shopify, team
// webhooks, the AI's tool loop, and approving or declining a held run. HTTP
// and the model are faked. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, test } from "node:test";
import { and, eq, like } from "drizzle-orm";

const ORG = "org_test_ai_actions";
const SK = ["rk", "test", "abcdefghijklmnop"].join("_");

after(async () => {
  const { pool } = await import("@/db");
  await pool.end();
});

async function fresh() {
  const { db, schema } = await import("@/db");
  const { seal } = await import("./import/crypto");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Acme Support", aiEnabled: false });
  await db.insert(schema.agents).values({ orgId: ORG, userId: "user_admin", name: "Ada Admin", email: "ada@acme.test", role: "admin" });
  await db.insert(schema.integrations).values([
    { orgId: ORG, kind: "stripe", account: "Acme", credentials: seal({ key: SK }), connectedBy: "user_admin" },
    { orgId: ORG, kind: "shopify", account: "acme.myshopify.com", credentials: seal({ domain: "acme.myshopify.com", token: "shpat_x" }), connectedBy: "user_admin" },
  ]);
  await db.delete(schema.rateLimits).where(like(schema.rateLimits.key, `%${ORG}%`));
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// A fake Stripe and Shopify. kim owns cus_kim; ch_kim and sub_kim are hers, ch_other isn't.
function fakeApis(log: { url: string; init?: RequestInit }[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    log.push({ url, init });
    if (url.includes("/customers?")) return json({ data: url.includes("kim%40example.com") ? [{ id: "cus_kim" }] : [] });
    if (url.endsWith("/charges/ch_kim")) return json({ id: "ch_kim", customer: "cus_kim", amount: 4900, amount_refunded: 0, currency: "usd", status: "succeeded", created: 1_790_000_000, refunded: false, description: null });
    if (url.endsWith("/charges/ch_other")) return json({ id: "ch_other", customer: "cus_other", amount: 9900, amount_refunded: 0, currency: "usd", status: "succeeded", created: 1_790_000_000, refunded: false, description: null });
    if (url.includes("/charges?")) return json({ data: [{ id: "ch_kim", customer: "cus_kim", amount: 4900, amount_refunded: 0, currency: "usd", status: "succeeded", created: 1_790_000_000, refunded: false, description: "Pro plan" }] });
    if (url.includes("/subscriptions?")) return json({ data: [] });
    if (url.endsWith("/v1/refunds")) return json({ id: "re_1", status: "succeeded" });
    if (url.includes("myshopify.com")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { query: string; variables: { id?: string } };
      if (body.query.includes("orderCancel")) return json({ data: { orderCancel: { job: { id: "j" }, orderCancelUserErrors: [] } } });
      if (body.query.includes("order(id")) {
        const shipped = body.variables.id?.endsWith("/2");
        return json({
          data: {
            order: {
              id: body.variables.id,
              name: shipped ? "#1002" : "#1001",
              createdAt: "2026-10-01T00:00:00Z",
              email: "kim@example.com",
              cancelledAt: null,
              displayFinancialStatus: "PAID",
              displayFulfillmentStatus: shipped ? "FULFILLED" : "UNFULFILLED",
              totalPriceSet: { shopMoney: { amount: "54.00", currencyCode: "USD" } },
              lineItems: { nodes: [{ title: "Linen shirt", quantity: 1 }] },
              fulfillments: [],
            },
          },
        });
      }
      return json({ data: { orders: { nodes: [] } } });
    }
    if (url.startsWith("https://hooks.acme.test/")) {
      if (url.endsWith("/broken")) return new Response("nope", { status: 500 });
      return json({ message: url.endsWith("/plan") ? "Kim is on Pro, renews Nov 1." : "Reset email sent." });
    }
    return new Response("not faked", { status: 404 });
  }) as typeof fetch;
}

test("approval rules: always, never, and over a limit", async () => {
  const { needsApproval } = await import("./ai-actions");
  assert.equal(needsApproval({ approval: "always", limitCents: null, lookup: false }, 100), true);
  assert.equal(needsApproval({ approval: "never", limitCents: null, lookup: false }, 1_000_000), false);
  assert.equal(needsApproval({ approval: "over_limit", limitCents: 5000, lookup: false }, 4900), false);
  assert.equal(needsApproval({ approval: "over_limit", limitCents: 5000, lookup: false }, 5001), true);
  assert.equal(needsApproval({ approval: "over_limit", limitCents: 5000, lookup: false }, null), true, "no amount means a person looks");
  assert.equal(needsApproval({ approval: "always", limitCents: null, lookup: true }, null), false, "lookups never wait");
});

test("Stripe refunds and Shopify cancels only touch the customer's own payments and orders", async () => {
  const { checkStripeRefund, checkShopifyCancel, parseAmount } = await import("./integrations/writes");
  const log: { url: string; init?: RequestInit }[] = [];
  const f = fakeApis(log);
  assert.equal(parseAmount("12.50", "usd"), 1250);
  assert.equal(parseAmount("500", "jpy"), 500);
  assert.equal(parseAmount("-1", "usd"), null);

  const theirs = await checkStripeRefund(SK, "kim@example.com", { payment_id: "ch_other", amount: "" }, f);
  assert.deepEqual(theirs, { error: "That payment isn't one of this customer's." });
  const tooMuch = await checkStripeRefund(SK, "kim@example.com", { payment_id: "ch_kim", amount: "100" }, f);
  assert.ok("error" in tooMuch && /49.00 USD/.test(tooMuch.error));
  const ok = await checkStripeRefund(SK, "kim@example.com", { payment_id: "ch_kim", amount: "10" }, f);
  assert.ok("summary" in ok);
  assert.equal(ok.amountCents, 1000);
  assert.match(ok.summary, /Refund 10.00 USD of the 49.00 USD payment/);
  assert.ok(!log.some((l) => l.url.endsWith("/refunds")), "checking changes nothing");
  await ok.run("run-1");
  const refund = log.find((l) => l.url.endsWith("/refunds"))!;
  assert.equal(new URLSearchParams(String(refund.init?.body)).get("amount"), "1000");
  assert.equal((refund.init?.headers as Record<string, string>)["idempotency-key"], "run-1");

  const creds = { domain: "acme.myshopify.com", token: "shpat_x" };
  const token = async () => "shpat_x";
  assert.deepEqual(await checkShopifyCancel(creds, token, "someone@else.com", { order_id: "gid://shopify/Order/1" }, f), { error: "That order isn't one of this customer's." });
  const shipped = await checkShopifyCancel(creds, token, "kim@example.com", { order_id: "2" }, f);
  assert.ok("error" in shipped && /fulfilled/.test(shipped.error));
  const cancel = await checkShopifyCancel(creds, token, "KIM@example.com", { order_id: "gid://shopify/Order/1" }, f);
  assert.ok("summary" in cancel && cancel.amountCents === 5400);
});

test("the AI gets actions and records only on emailed tickets, and a change waits until it answers", async () => {
  await fresh();
  const { db, schema } = await import("@/db");
  const { actionContext } = await import("./ai-actions");
  const { createTicket } = await import("./tickets");
  const { draftAnswer } = await import("./ai");
  const log: { url: string; init?: RequestInit }[] = [];
  const f = fakeApis(log);
  await db.insert(schema.aiActions).values([
    { orgId: ORG, kind: "stripe_refund", name: "Refund a Stripe payment", approval: "over_limit", limitCents: 5000, createdBy: "user_admin" },
    { orgId: ORG, kind: "webhook", name: "Look up plan", url: "https://hooks.acme.test/plan", lookup: true, approval: "never", createdBy: "user_admin" },
  ]);
  const org = { id: ORG, aiReadsRecords: false };
  const chat = await createTicket({ orgId: ORG, channel: "chat", customerEmail: "kim@example.com", subject: "Refund", body: "Refund me", authorType: "customer" });
  assert.equal(await actionContext(org, { ...chat, test: false }, { email: "kim@example.com", name: "Kim" }, f), null, "chat visitors get nothing");

  const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: "kim@example.com", customerName: "Kim", subject: "Refund", body: "Please refund my last payment", authorType: "customer" });
  const ctx = await actionContext(org, { ...t, test: false }, { email: "kim@example.com", name: "Kim" }, f);
  assert.ok(ctx);
  assert.deepEqual(ctx.tools.map((x) => x.name), ["stripe_refund", "webhook_2"]);
  assert.match(ctx.records, /Payment ch_kim: 49.00 USD/, "a Stripe action brings Stripe records");

  // The model: looks up the plan, refunds, then answers.
  const seen: unknown[] = [];
  const usage = { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const replies = [
    { stop_reason: "tool_use", content: [{ type: "thinking", thinking: "…", signature: "s" }, { type: "tool_use", id: "t1", name: "webhook_2", input: {} }] },
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t2", name: "stripe_refund", input: { payment_id: "ch_kim", amount: "" } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "{}" }], parsed_output: { decision: "answer", reply: "Hi Kim, I've refunded your payment.", reason: "Refund asked for.", sources: [] } },
  ];
  const call = (async (params: { messages: unknown[]; tools?: unknown[] }) => {
    seen.push(structuredClone(params.messages));
    assert.equal(params.tools?.length, 2);
    return { model: "claude-opus-5-5", usage, ...replies[seen.length - 1] };
  }) as never;
  const d = await draftAnswer({ id: ORG, name: "Acme", aiInstructions: "" }, [], { from: "Kim <kim@example.com>", subject: "Refund", body: "Please refund", attached: [] }, undefined, [], false, ctx, call);
  assert.equal(d.decision, "answer");
  assert.equal(d.metered.outputTokens, 150, "every round is metered");
  const second = seen[1] as { role: string; content: { type: string; content?: string }[] }[];
  assert.equal(second[1].content[0].type, "thinking", "thinking blocks go back unchanged");
  assert.equal(second[2].content[0].content, "Kim is on Pro, renews Nov 1.", "the lookup's answer goes to the AI");
  assert.ok(ctx.pending && !ctx.pending.approval, "49.00 is under the 50.00 limit");
  assert.ok(!log.some((l) => l.url.endsWith("/refunds")), "nothing changes until the reply is final");

  // A second change in the same reply is refused.
  const again = await ctx.use("stripe_refund", { payment_id: "ch_kim", amount: "1" });
  assert.equal(again.isError, true);
  // Someone else's payment is refused.
  const ctx2 = await actionContext(org, { ...t, test: false }, { email: "kim@example.com", name: "Kim" }, f);
  const stolen = await ctx2!.use("stripe_refund", { payment_id: "ch_other", amount: "" });
  assert.equal(stolen.isError, true);
  assert.equal(ctx2!.pending, null);

  const lookups = await db.select().from(schema.aiActionRuns).where(eq(schema.aiActionRuns.ticketId, t.id));
  assert.deepEqual(lookups.map((r) => r.status), ["done"], "the lookup is on record");
});

test("webhooks are signed; a held change runs on approval and sends the AI's reply; declining changes nothing", async () => {
  await fresh();
  const { db, schema } = await import("@/db");
  const { decideRun, holdPending, runPending, webhookBody } = await import("./ai-actions");
  const { createTicket } = await import("./tickets");
  const log: { url: string; init?: RequestInit }[] = [];
  const f = fakeApis(log);
  const [reset] = await db.insert(schema.aiActions).values({ orgId: ORG, kind: "webhook", name: "Send a password reset", url: "https://hooks.acme.test/reset", approval: "always", createdBy: "user_admin" }).returning();
  const [broken] = await db.insert(schema.aiActions).values({ orgId: ORG, kind: "webhook", name: "Broken", url: "https://hooks.acme.test/broken", approval: "never", createdBy: "user_admin" }).returning();
  const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: "kim@example.com", subject: "Can't sign in", body: "Locked out", authorType: "customer" });
  const info = { id: t.id, number: t.number, subject: t.subject, channel: "email", test: false };
  const kim = { email: "kim@example.com", name: "Kim" };

  // Runs now and fails: the error comes back, nothing is sent.
  const failed = await runPending(ORG, info, kim, { action: broken, inputs: {}, summary: "Broken", amountCents: null, approval: false }, null, f);
  assert.deepEqual(failed, { ok: false, error: "Your endpoint answered 500: nope" });

  // Held for approval, then approved.
  const run = await holdPending(ORG, t.id, { action: reset, inputs: {}, summary: "Send a password reset", amountCents: null, approval: true }, "Hi Kim, check your inbox for a reset link.", null, false);
  const approved = await decideRun(ORG, run.id, { userId: "user_admin", name: "Ada Admin" }, true, f);
  assert.deepEqual(approved, { ok: true, message: "Done, and the AI's reply was sent." });
  const call = log.find((l) => l.url.endsWith("/reset"))!;
  const headers = call.init?.headers as Record<string, string>;
  const body = String(call.init?.body);
  assert.equal(headers["x-flatdesk-signature"], `sha256=${createHmac("sha256", reset.secret).update(body).digest("hex")}`);
  assert.equal(JSON.parse(body).customer.email, "kim@example.com");
  assert.equal(JSON.parse(body).run_id, run.id);
  assert.ok(webhookBody(reset, {}, info, kim, run.id).includes('"event":"ai_action"'));
  const [ticket] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, t.id));
  assert.equal(ticket.status, "pending");
  assert.equal(ticket.resolvedByAi, true);
  const ai = await db.select().from(schema.messages).where(and(eq(schema.messages.ticketId, t.id), eq(schema.messages.authorType, "ai")));
  assert.match(ai[0].body, /^Hi Kim, check your inbox/);
  assert.deepEqual(await decideRun(ORG, run.id, { userId: "user_admin", name: "Ada Admin" }, false, f), { error: "Someone already decided this one." });

  // Declined: no call, no reply.
  const calls = log.length;
  const run2 = await holdPending(ORG, t.id, { action: reset, inputs: {}, summary: "Send a password reset", amountCents: null, approval: true }, "Again", null, false);
  await decideRun(ORG, run2.id, { userId: "user_admin", name: "Ada Admin" }, false, f);
  assert.equal(log.length, calls);
  const [r2] = await db.select().from(schema.aiActionRuns).where(eq(schema.aiActionRuns.id, run2.id));
  assert.equal(r2.status, "declined");
});

test("test tickets never change Stripe", async () => {
  await fresh();
  const { db, schema } = await import("@/db");
  const { runPending } = await import("./ai-actions");
  const { createTicket } = await import("./tickets");
  const log: { url: string; init?: RequestInit }[] = [];
  const [refund] = await db.insert(schema.aiActions).values({ orgId: ORG, kind: "stripe_refund", name: "Refund", approval: "never", createdBy: "user_admin" }).returning();
  const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: "kim@example.com", subject: "Refund", body: "Refund", authorType: "customer" });
  const r = await runPending(ORG, { id: t.id, number: t.number, subject: "Refund", channel: "email", test: true }, { email: "kim@example.com", name: null }, { action: refund, inputs: { payment_id: "ch_kim", amount: "" }, summary: "Refund", amountCents: 4900, approval: false }, null, fakeApis(log));
  assert.ok(r.ok && /Test ticket/.test(r.result));
  assert.ok(!log.some((l) => l.url.endsWith("/refunds")));
});
