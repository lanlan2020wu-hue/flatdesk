// Launch-readiness pieces: attachments, the trial lock and AI cost logging. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { and, asc, eq } from "drizzle-orm";

process.env.INBOUND_DOMAIN = "in.flatdesk.test";
process.env.EMAIL_FROM = "support@mail.flatdesk.test";

const ORG = "org_test_launch";

after(async () => {
  const { pool } = await import("@/db");
  await pool.end();
});

test("email attachments are kept on the message, too-large ones are named in a note, and replies thread with theirs", async () => {
  const { db, schema } = await import("@/db");
  const { handleInboundEmail } = await import("./inbound");
  const { attachmentsByMessage, downloadInbound, INBOUND_FILE_LIMIT, loadAttachment } = await import("./attachments");

  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Launch team", inboundKey: "launch0001" });

  const served: string[] = [];
  const fakeFetch = (async (url: string) => {
    served.push(url);
    return new Response(`bytes of ${url}`);
  }) as unknown as typeof fetch;
  const list = [
    { id: "a1", filename: "invoice.pdf", size: 1200, content_type: "application/pdf", content_disposition: "attachment", download_url: "https://files/a1" },
    { id: "a2", filename: "logo.png", size: 800, content_type: "image/png", content_disposition: "inline", download_url: "https://files/a2" },
    { id: "a3", filename: "../../video.mov", size: INBOUND_FILE_LIMIT + 1, content_type: "video/quicktime", content_disposition: "attachment", download_url: "https://files/a3" },
  ];

  const result = await handleInboundEmail({
    from: "Sam <sam@example.com>",
    to: ["launch0001@in.flatdesk.test"],
    subject: "Invoice looks wrong",
    text: "See attached.",
    headers: null,
    messageId: "<att-1@example.com>",
    attachments: () => downloadInbound(list, fakeFetch),
  });
  assert.equal(result.action, "created");
  assert.deepEqual(served, ["https://files/a1"], "signature images and oversized files aren't downloaded");

  const ticket = await db.query.tickets.findFirst({ where: and(eq(schema.tickets.orgId, ORG), eq(schema.tickets.number, result.ticket!)) });
  const thread = await db.select().from(schema.messages).where(eq(schema.messages.ticketId, ticket!.id)).orderBy(asc(schema.messages.createdAt));
  const files = await attachmentsByMessage(ORG, thread.map((m) => m.id));
  assert.deepEqual(files.get(thread[0].id)?.map((f) => f.filename), ["invoice.pdf"]);
  const note = thread.find((m) => m.authorType === "system");
  assert.match(note?.body ?? "", /video\.mov/, "the skipped file is named, without its path");
  assert.equal(note?.internal, true);

  const file = await loadAttachment(ORG, files.get(thread[0].id)![0].id);
  assert.equal(file?.data.toString(), "bytes of https://files/a1");
  assert.equal(await loadAttachment("org_other", file!.id), null, "another team can't read it");
});

test("downloads never render scripts, and odd filenames are made safe", async () => {
  const { cleanFilename, downloadResponse } = await import("./attachments");
  const svg = downloadResponse({ filename: "x.svg", contentType: "image/svg+xml", data: Buffer.from("<svg/>") });
  assert.equal(svg.headers.get("content-type"), "application/octet-stream");
  assert.match(svg.headers.get("content-disposition")!, /^attachment;/);
  const png = downloadResponse({ filename: "shot.png", contentType: "image/png", data: Buffer.from("p") });
  assert.match(png.headers.get("content-disposition")!, /^inline;/);
  assert.equal(png.headers.get("x-content-type-options"), "nosniff");
  assert.equal(cleanFilename('C:\\Users\\me\\"re:port".pdf'), "report.pdf");
  assert.equal(cleanFilename(""), "attachment");
});

test("a team gets 14 days without a card, then the app locks until a plan is active", async () => {
  process.env.STRIPE_SECRET_KEY ??= "sk_test_dummy";
  const { access, TRIAL_DAYS } = await import("./billing");
  const day = 24 * 60 * 60 * 1000;
  const now = new Date("2026-10-20T12:00:00Z");
  const fresh = { createdAt: new Date(now.getTime() - 2 * day), subscriptionStatus: null };
  assert.deepEqual(access(fresh, now), { state: "trial", daysLeft: TRIAL_DAYS - 2 });
  const old = { createdAt: new Date(now.getTime() - (TRIAL_DAYS + 1) * day), subscriptionStatus: null };
  assert.deepEqual(access(old, now), { state: "locked" });
  assert.deepEqual(access({ ...old, subscriptionStatus: "active" }, now), { state: "open" });
  assert.deepEqual(access({ ...old, subscriptionStatus: "past_due" }, now), { state: "open" }, "Stripe is still retrying");
  assert.deepEqual(access({ ...old, subscriptionStatus: "canceled" }, now), { state: "locked" });
});

test("AI cost logging prices cache writes and reads at their own rates", async () => {
  const { callCost } = await import("./ai");
  // 1M each of plain input, cache write, cache read and output: $5 + $6.25 + $0.50 + $25.
  const cost = callCost({ input_tokens: 1e6, cache_creation_input_tokens: 1e6, cache_read_input_tokens: 1e6, output_tokens: 1e6 });
  assert.equal(cost.toFixed(2), "36.75");
  assert.equal(callCost({ input_tokens: 100, output_tokens: 0 }), 0.0005);
});

test("a no-card trial gets a smaller AI allowance for the whole trial, with no overage; a card lifts it", async () => {
  process.env.STRIPE_SECRET_KEY ??= "sk_test_dummy";
  const { db, schema } = await import("@/db");
  const { aiUsage, monthKey, reserveSlot } = await import("./ai");
  const { PLAN } = await import("./pricing");
  const T = "org_test_trial_ai";
  await db.delete(schema.orgs).where(eq(schema.orgs.id, T));
  // Created 3 days ago, overage switched on (it must not apply in the trial).
  await db.insert(schema.orgs).values({ id: T, name: "Trial team", createdAt: new Date(Date.now() - 3 * 86_400_000), aiOverageEnabled: true });
  await db.insert(schema.agents).values([
    { orgId: T, userId: "user_t1", name: "A", email: "a@trial.dev", role: "admin" },
    { orgId: T, userId: "user_t2", name: "B", email: "b@trial.dev", role: "agent" },
  ]);
  const lastMonth = monthKey(new Date(Date.now() - 32 * 86_400_000));
  // 10 answers "last month" (a trial can span two months) and 39 this month.
  await db.insert(schema.aiEvents).values([
    ...Array.from({ length: 10 }, () => ({ orgId: T, kind: "resolution" as const, month: lastMonth, overage: false, model: "test" })),
    ...Array.from({ length: 39 }, () => ({ orgId: T, kind: "resolution" as const, month: monthKey(), overage: false, model: "test" })),
  ]);

  const usage = await aiUsage(T);
  assert.deepEqual(usage, { included: 2 * PLAN.trialPerAgent, used: 49, overage: 0, month: monthKey(), trial: true });
  const last = await reserveSlot(T, null as unknown as string);
  assert.ok("eventId" in last, "the 50th answer still fits");
  const paused = await reserveSlot(T, null as unknown as string);
  assert.ok("paused" in paused && /free trial/.test(paused.paused), "the 51st pauses, overage or not");

  await db.update(schema.orgs).set({ subscriptionStatus: "trialing" }).where(eq(schema.orgs.id, T));
  const paid = await aiUsage(T);
  assert.deepEqual([paid.included, paid.used, paid.trial], [2 * PLAN.includedPerAgent, 40, false], "a card on file: this month only, full allowance");
  assert.ok("eventId" in (await reserveSlot(T, null as unknown as string)));
});
