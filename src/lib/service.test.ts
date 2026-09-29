// Alerts, one-click ratings and first-reply targets. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";

process.env.INBOUND_DOMAIN = "in.flatdesk.test";

const ORG = "org_test_service";
const posts: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];
let status = 200;
const hook = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    posts.push({ headers: req.headers, body });
    res.statusCode = status;
    res.end(status === 200 ? "ok" : "nope");
  });
});
let hookUrl = "";

before(async () => {
  await new Promise<void>((r) => hook.listen(0, "127.0.0.1", r));
  hookUrl = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/hook`;
});

after(async () => {
  hook.close();
  const { pool } = await import("@/db");
  await pool.end();
});

async function setup(org: Partial<{ alertOn: "team" | "all"; firstResponseMinutes: number | null }> = {}) {
  const { db, schema } = await import("@/db");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  // The URL check refuses local addresses, so the test server's is written directly.
  await db.insert(schema.orgs).values({ id: ORG, name: "Service team", inboundKey: "svctest001", widgetKey: "svcwidget001", aiEnabled: false, alertWebhookUrl: hookUrl, ...org });
  await db.insert(schema.agents).values({ orgId: ORG, userId: "u1", name: "Ana", email: "ana@acme.com", role: "admin" });
  posts.length = 0;
  status = 200;
  return { db, schema };
}

test("first-reply due times skip nights and weekends in the team's time zone", async () => {
  const { dueAt } = await import("./sla");
  const ny = { tz: "America/New_York", days: [1, 2, 3, 4, 5], start: 9 * 60, end: 17 * 60 };
  // Around the clock: just the target later.
  assert.equal(dueAt(new Date("2026-09-29T12:00:00Z"), 240, null).toISOString(), "2026-09-29T16:00:00.000Z");
  // Tuesday 3 PM in New York (19:00 UTC, EDT): 2 hours left that day, 2 more from 9 AM Wednesday.
  assert.equal(dueAt(new Date("2026-09-29T19:00:00Z"), 240, ny).toISOString(), "2026-09-30T15:00:00.000Z");
  // Friday 4 PM: 1 hour Friday, the rest Monday from 9 AM.
  assert.equal(dueAt(new Date("2026-10-02T20:00:00Z"), 240, ny).toISOString(), "2026-10-05T16:00:00.000Z");
  // Saturday: starts Monday 9 AM.
  assert.equal(dueAt(new Date("2026-10-03T15:00:00Z"), 60, ny).toISOString(), "2026-10-05T14:00:00.000Z");
  // Across the November DST change (EST is UTC-5): Friday 4:30 PM EDT, 1 hour -> Monday 9:30 AM EST.
  assert.equal(dueAt(new Date("2026-10-30T20:30:00Z"), 60, ny).toISOString(), "2026-11-02T14:30:00.000Z");
});

test("a ticket's place against the target", async () => {
  const { slaState } = await import("./sla");
  const org = { firstResponseMinutes: 60, businessHours: null };
  const created = new Date("2026-09-29T12:00:00Z");
  const at = (m: number) => new Date(created.getTime() + m * 60_000);
  const t = { status: "open", createdAt: created, firstResponseAt: null, source: null };
  assert.deepEqual(slaState(t, org, at(10)), { kind: "waiting", due: at(60), minutesLeft: 50, soon: false });
  assert.equal((slaState(t, org, at(50)) as { soon: boolean }).soon, true);
  assert.deepEqual(slaState(t, org, at(95)), { kind: "overdue", due: at(60), minutesLate: 35 });
  assert.equal(slaState({ ...t, firstResponseAt: at(30) }, org)?.kind, "met");
  assert.equal(slaState({ ...t, firstResponseAt: at(90) }, org)?.kind, "missed");
  // Imported tickets, waiting tickets that aren't open, and teams without a target: nothing.
  assert.equal(slaState({ ...t, source: "zendesk" }, org, at(95)), null);
  assert.equal(slaState({ ...t, status: "pending" }, org, at(95)), null);
  assert.equal(slaState(t, { ...org, firstResponseMinutes: null }, at(95)), null);
});

test("webhook addresses must be public https; each tool gets its own format", async () => {
  const { checkWebhookUrl, buildRequest, sign } = await import("./alerts");
  assert.ok("url" in checkWebhookUrl("https://hooks.slack.com/services/T/B/x"));
  for (const bad of ["http://hooks.slack.com/x", "https://127.0.0.1/x", "https://[::1]/x", "https://localhost/x", "https://metadata.internal/x", "https://intranet/x", "not a url"]) {
    assert.ok("error" in checkWebhookUrl(bad), bad);
  }
  const payload = {
    event: "ticket.created" as const,
    text: "New ticket for the team: #7 Refund <now> & more from sam@x.co by email.",
    needsTeam: true,
    reason: null,
    ticket: { number: 7, subject: "Refund <now> & more", channel: "email", status: "open", url: "https://app.test/app/tickets/7", customer: { name: null, email: "sam@x.co" }, assignee: null },
    sentAt: "2026-09-29T00:00:00Z",
  };
  const slack = JSON.parse(buildRequest("https://hooks.slack.com/services/T/B/x", "s", payload).body);
  assert.equal(slack.text, "New ticket for the team: <https://app.test/app/tickets/7|#7 Refund &lt;now&gt; &amp; more> from sam@x.co by email.");
  const discord = JSON.parse(buildRequest("https://discord.com/api/webhooks/1/abc", "s", payload).body);
  assert.match(discord.content, /https:\/\/app\.test\/app\/tickets\/7$/);
  const generic = buildRequest("https://example.com/hook", "secret", payload);
  assert.equal(generic.headers["x-flatdesk-signature"], sign("secret", generic.body));
  assert.equal(JSON.parse(generic.body).ticket.number, 7);
});

test("new tickets that need a person are posted; ones the AI answered only when asked for all", async () => {
  const { db, schema } = await setup();
  const { createTicket } = await import("./tickets");
  const { alertNewTicket } = await import("./alerts");
  const t = await createTicket({ orgId: ORG, channel: "chat", customerEmail: "sam@example.com", customerName: "Sam", subject: "Where is my order?", body: "Hi", authorType: "customer" });
  await alertNewTicket(ORG, t.id);
  assert.equal(posts.length, 1);
  const sent = JSON.parse(posts[0].body);
  assert.equal(sent.event, "ticket.created");
  assert.equal(sent.needsTeam, true);
  assert.equal(sent.ticket.customer.email, "sam@example.com");
  assert.match(sent.text, /^New ticket for the team: #\d+ Where is my order\? from Sam \(sam@example\.com\) by chat\.$/);

  // An AI-answered ticket: nothing in "team" mode, an "answered by the AI" post in "all" mode.
  await db.update(schema.tickets).set({ resolvedByAi: true, status: "pending" }).where(eq(schema.tickets.id, t.id));
  await alertNewTicket(ORG, t.id);
  assert.equal(posts.length, 1);
  await db.update(schema.orgs).set({ alertOn: "all" }).where(eq(schema.orgs.id, ORG));
  await alertNewTicket(ORG, t.id);
  assert.equal(posts.length, 2);
  assert.equal(JSON.parse(posts[1].body).needsTeam, false);

  // A failing endpoint is recorded for the settings page and never throws.
  status = 500;
  await alertNewTicket(ORG, t.id);
  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, ORG) });
  assert.match(org!.alertLastError ?? "", /^500/);
});

test("ratings: one per reply, scanners dropped, and Not good on an AI answer hands the ticket back", async () => {
  const { db, schema } = await setup();
  const { createTicket } = await import("./tickets");
  const { recordRating, ratingsForTicket, csatReport } = await import("./csat");
  const route = (await import("@/app/api/rate/[id]/route")).POST;
  const call = (id: string, body: object) =>
    route(new Request(`http://x/api/rate/${id}`, { method: "POST", body: JSON.stringify(body), headers: { "x-forwarded-for": "203.0.113.9" } }), { params: Promise.resolve({ id }) } as never);
  await db.delete(schema.rateLimits);

  const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: "kim@example.com", subject: "Reset", body: "How?", authorType: "customer" });
  const [agentReply] = await db.insert(schema.messages).values({ orgId: ORG, ticketId: t.id, authorType: "agent", authorId: "u1", body: "Like this." }).returning();
  const [note] = await db.insert(schema.messages).values({ orgId: ORG, ticketId: t.id, authorType: "agent", authorId: "u1", body: "Internal", internal: true }).returning();

  assert.equal((await recordRating(note.id, "great")).ok, false); // internal notes can't be rated
  assert.equal((await recordRating(t.messageId, "great")).ok, false); // nor the customer's own message

  // A scanner opening all three links at once leaves no rating.
  const t0 = new Date();
  assert.equal((await recordRating(agentReply.id, "great", { now: t0 })).ok, true);
  assert.equal((await recordRating(agentReply.id, "bad", { now: new Date(t0.getTime() + 500) })).ok, false);
  assert.equal((await ratingsForTicket(ORG, t.id)).size, 0);
  // A person who changes their mind on the page is fine.
  await recordRating(agentReply.id, "great");
  assert.equal((await recordRating(agentReply.id, "okay", { change: true })).ok, true);
  assert.equal((await call(agentReply.id, { comment: "Fast, thanks" })).status, 200);
  const saved = (await ratingsForTicket(ORG, t.id)).get(agentReply.id);
  assert.deepEqual({ rating: saved?.rating, comment: saved?.comment }, { rating: "okay", comment: "Fast, thanks" });

  // Not good on the AI's answer: the ticket goes back to the team, stops counting, and an alert goes out.
  const u = await createTicket({ orgId: ORG, channel: "email", customerEmail: "lee@example.com", subject: "Hours", body: "When?", authorType: "customer" });
  const [aiReply] = await db.insert(schema.messages).values({ orgId: ORG, ticketId: u.id, authorType: "ai", body: "9 to 5." }).returning();
  await db.update(schema.tickets).set({ resolvedByAi: true, status: "pending" }).where(eq(schema.tickets.id, u.id));
  await db.insert(schema.aiEvents).values({ orgId: ORG, ticketId: u.id, kind: "resolution", month: "2026-09", model: "m" });
  posts.length = 0;
  const res = await call(aiReply.id, { rating: "bad", change: false });
  assert.equal(res.status, 200);
  const ticket = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, u.id) });
  assert.deepEqual({ status: ticket?.status, resolvedByAi: ticket?.resolvedByAi }, { status: "open", resolvedByAi: false });
  const [event] = await db.select().from(schema.aiEvents).where(eq(schema.aiEvents.ticketId, u.id));
  assert.equal(event.kind, "handoff");
  assert.equal(posts.length, 1);
  assert.equal(JSON.parse(posts[0].body).event, "ticket.handed_back");

  const report = await csatReport(ORG, new Date(Date.now() - 86_400_000));
  assert.deepEqual(report.all, { total: 2, great: 0, bad: 1 });
  assert.equal(report.byAgent.get("u1")?.total, 1);
});

test("reply emails carry rating links, with the reply escaped in the HTML part", async () => {
  const { csatText, replyHtml } = await import("./csat");
  const id = "0b7c3a52-4f7e-4c1e-9f55-2d1d8a1b2c3d";
  assert.match(csatText(id), /Great: http.*\/rate\/0b7c3a52-4f7e-4c1e-9f55-2d1d8a1b2c3d\/great\nOkay: .*\/okay\nNot good: .*\/bad$/);
  const html = replyHtml("Use <b>this</b> & that", id);
  assert.ok(html.includes("Use &lt;b&gt;this&lt;/b&gt; &amp; that"));
  assert.equal((html.match(/\/rate\//g) ?? []).length, 3);
  assert.ok(!replyHtml("Hi", null).includes("/rate/"));
});
