// End-to-end import tests against a real Postgres, with each help desk's API
// replaced by recorded-shape fixtures. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { db, pool, schema } from "@/db";
import { createTicket } from "@/lib/tickets";
import { runStep, startImport } from "./engine";
import { linkImportedAgent } from "./link";
import { importReport } from "./report";
import { fakeApi, FIXTURES } from "./fixtures";
import type { FetchLike } from "./http";
import type { SourceId } from "./types";

async function runToEnd(orgId: string, source: SourceId, creds: Record<string, string>, fetchImpl: FetchLike) {
  const { id } = await startImport({ orgId, userId: "user_ana", source, creds, fetchImpl });
  for (let i = 0; i < 100; i++) {
    const job = await runStep(orgId, id, { fetchImpl, budgetMs: 5_000 });
    if (job?.status !== "running") return job!;
  }
  throw new Error("import didn't finish");
}

async function newOrg(id: string) {
  await db.delete(schema.orgs).where(eq(schema.orgs.id, id));
  await db.insert(schema.orgs).values({ id, name: "Test team" });
  await db.insert(schema.agents).values({ orgId: id, userId: "user_ana", name: "Ana", email: "ana@acme.com", role: "admin" });
}

const ticketByNumber = (orgId: string, number: number) =>
  db.query.tickets.findFirst({ where: and(eq(schema.tickets.orgId, orgId), eq(schema.tickets.number, number)) });
const messagesOf = (ticketId: string) =>
  db.query.messages.findMany({ where: eq(schema.messages.ticketId, ticketId), orderBy: (m, { asc }) => [asc(m.createdAt)] });

before(async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must point at a test database");
});
after(async () => {
  await pool.end();
});

describe("Zendesk", () => {
  const ORG = "org_test_zendesk";
  const Z = "https://acme.zendesk.com/api/v2/";
  const routes = FIXTURES.zendesk.routes;

  test("imports everything, keeps originals and reports what didn't map", async () => {
    await newOrg(ORG);
    // A live ticket already holds #1, so Zendesk's #1 must get a new number.
    await createTicket({ orgId: ORG, channel: "email", customerEmail: "x@y.co", subject: "Live", body: "hi", authorType: "customer" });

    const api = fakeApi(Z, routes);
    const job = await runToEnd(ORG, "zendesk", { subdomain: "acme", email: "ana@acme.com", token: "t" }, api);
    assert.equal(job.status, "done", job.error ?? "");
    assert.equal(job.credentials, null, "credentials are erased when the import ends");

    const t = await ticketByNumber(ORG, 4521);
    assert.ok(t, "keeps the Zendesk ticket number");
    assert.equal(t.status, "closed");
    assert.equal(t.assigneeId, "user_ana", "assignee matched by email, case-insensitively");
    assert.deepEqual(t.tags, ["billing-issue", "vip"]);
    assert.equal(t.fields.Priority, "high");
    assert.equal(t.fields.Group, "Billing");
    assert.equal(t.fields.Plan, "Pro plan", "custom field labelled and option value named");
    assert.equal(t.fields["Original tags"], "Billing Issue, vip");
    assert.equal(t.createdAt.toISOString(), "2024-01-02T10:00:00.000Z");
    assert.equal(t.firstResponseAt?.toISOString(), "2024-01-02T12:00:00.000Z", "first public agent reply, not the internal note");

    const msgs = await messagesOf(t.id);
    assert.equal(msgs.length, 3);
    assert.match(msgs[0].body, /Attachments:\n- statement\.png: https:\/\/acme\.zendesk\.com/);
    assert.equal(msgs[0].authorType, "customer");
    assert.equal(msgs[1].internal, true);
    assert.equal(msgs[1].authorName, "Bo");
    assert.equal(msgs[1].authorId, null, "Bo hasn't joined yet");
    assert.equal(msgs[2].authorId, "user_ana");

    const customer = await db.query.customers.findFirst({ where: eq(schema.customers.id, t.customerId) });
    assert.equal(customer?.fields.Organization, "Northwind");
    assert.equal(customer?.fields.Phone, "+1 555 0100");

    // Deleted tickets stay in the archive only.
    const deleted = await db.query.importRecords.findFirst({ where: and(eq(schema.importRecords.orgId, ORG), eq(schema.importRecords.externalId, "4522")) });
    assert.equal(deleted?.mappedId, null);
    assert.ok(deleted?.raw);

    // Zendesk #1 collided with the live ticket.
    const phone = await db.query.tickets.findFirst({ where: and(eq(schema.tickets.orgId, ORG), eq(schema.tickets.externalId, "1")) });
    assert.ok(phone && phone.number !== 1);
    assert.equal(phone.pendingAssigneeEmail, "bo@acme.com");
    assert.equal(phone.fields.Channel, "voice");

    const macros = await db.query.macros.findMany({ where: eq(schema.macros.orgId, ORG) });
    assert.equal(macros.length, 1, "inactive macros aren't added");
    assert.equal(macros[0].body, "I've refunded you.");
    assert.deepEqual(macros[0].addTags, ["refund", "billing"]);
    assert.equal(macros[0].setStatus, "closed");
    assert.deepEqual(macros[0].notApplied, ["Set priority to high", "Assign to group Billing"]);

    const rules = await db.query.rules.findMany({ where: eq(schema.rules.orgId, ORG) });
    assert.deepEqual(rules.map((r) => [r.ifTag, r.assignTo]), [["vip", "user_ana"]]);
    const kept = await db.query.importedRules.findMany({ where: eq(schema.importedRules.orgId, ORG) });
    assert.equal(kept.length, 3, "every trigger is kept, running or not");

    const report = await importReport(ORG, job.id);
    const texts = report.issues.map((i) => i.issue);
    assert.ok(texts.includes("Deleted in the old help desk, so it wasn't imported"));
    assert.ok(texts.some((x) => x.startsWith("Has no email address; kept with a placeholder")));
    assert.ok(texts.includes("Kept for reference, not running: Flatdesk rules can only assign by tag"));
    assert.ok(texts.includes("Will start running when its agent joins Flatdesk"));
    assert.ok(texts.includes("Its original number was already used in Flatdesk, so it has a new number"));
    assert.equal(report.counts.ticket.found, 3);
    assert.equal(report.counts.ticket.imported, 2);

    // Bo joins: their ticket, messages and rule follow.
    await db.insert(schema.agents).values({ orgId: ORG, userId: "user_bo", name: "Bo", email: "bo@acme.com" });
    await linkImportedAgent(ORG, "user_bo", "Bo@acme.com");
    const phoneAfter = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, phone.id) });
    assert.equal(phoneAfter?.assigneeId, "user_bo");
    assert.equal((await messagesOf(t.id))[1].authorId, "user_bo");
    const rulesAfter = await db.query.rules.findMany({ where: eq(schema.rules.orgId, ORG) });
    assert.ok(rulesAfter.some((r) => r.ifTag === "refund" && r.assignTo === "user_bo"));
  });

  test("running the import again adds nothing twice", async () => {
    const before = await db.$count(schema.messages, eq(schema.messages.orgId, ORG));
    const job = await runToEnd(ORG, "zendesk", { subdomain: "acme.zendesk.com", email: "ana@acme.com", token: "t" }, fakeApi(Z, routes));
    assert.equal(job.status, "done");
    assert.equal(await db.$count(schema.messages, eq(schema.messages.orgId, ORG)), before);
    assert.equal(await db.$count(schema.tickets, eq(schema.tickets.orgId, ORG)), 3);
    assert.equal(await db.$count(schema.macros, eq(schema.macros.orgId, ORG)), 1);
  });

  test("a rejected token fails with a clear message and creates nothing", async () => {
    const api: FetchLike = async () => new Response("", { status: 401 });
    await assert.rejects(startImport({ orgId: ORG, userId: "user_ana", source: "zendesk", creds: { subdomain: "acme", email: "a@b.c", token: "bad" }, fetchImpl: api }), /rejected/);
  });

  test("a rate limit pauses the import instead of failing it", async () => {
    await newOrg(`${ORG}_rl`);
    let limited = true;
    const inner = fakeApi(Z, routes);
    const api: FetchLike = async (url, init) => {
      if (limited && url.includes("groups.json")) {
        limited = false;
        return new Response("", { status: 429, headers: { "Retry-After": "60" } });
      }
      return inner(url, init);
    };
    const { id } = await startImport({ orgId: `${ORG}_rl`, userId: "user_ana", source: "zendesk", creds: { subdomain: "acme", email: "a@b.c", token: "t" }, fetchImpl: api });
    const job = await runStep(`${ORG}_rl`, id, { fetchImpl: api, budgetMs: 5_000 });
    assert.equal(job?.status, "running");
    assert.ok(job?.retryAt && job.retryAt > new Date());
    assert.equal(job?.phase, "group");
  });
});

describe("Intercom", () => {
  const ORG = "org_test_intercom";
  const I = "https://api.intercom.io/";
  const routes = FIXTURES.intercom.routes;

  test("imports conversations with their parts and notes the missing rules API", async () => {
    await newOrg(ORG);
    const job = await runToEnd(ORG, "intercom", { token: "tok" }, fakeApi(I, routes));
    assert.equal(job.status, "done", job.error ?? "");
    assert.ok(job.notes.some((n) => n.includes("doesn't share workflows")));

    const t = await db.query.tickets.findFirst({ where: and(eq(schema.tickets.orgId, ORG), eq(schema.tickets.externalId, "900")) });
    assert.ok(t);
    assert.equal(t.status, "pending");
    assert.equal(t.channel, "chat");
    assert.equal(t.assigneeId, "user_ana");
    assert.equal(t.fields.Team, "Support");
    assert.equal(t.fields["Order ID"], "A-17");
    assert.deepEqual(t.tags, ["refund-request"]);
    const msgs = await messagesOf(t.id);
    assert.deepEqual(
      msgs.map((m) => [m.authorType, m.internal, m.body]),
      [
        ["customer", false, "Where is my refund?"],
        ["agent", false, "It's on the way."],
        ["agent", true, "Refund sent in Stripe"],
      ],
    );
    const macro = await db.query.macros.findFirst({ where: eq(schema.macros.orgId, ORG) });
    assert.equal(macro?.body, "Hi {{first_name}}, thanks!");
    const report = await importReport(ORG, job.id);
    assert.ok(report.issues.some((i) => i.issue.startsWith("Assignment and state-change events are kept")));
    assert.ok(report.issues.some((i) => i.issue.startsWith("Uses placeholders")));
  });
});

describe("Freshdesk", () => {
  const ORG = "org_test_freshdesk";
  const F = "https://acme.freshdesk.com/api/v2/";
  const routes = FIXTURES.freshdesk.routes;

  test("imports canned responses, scenarios, rules and tickets", async () => {
    await newOrg(ORG);
    const job = await runToEnd(ORG, "freshdesk", { domain: "acme", apiKey: "k" }, fakeApi(F, routes));
    assert.equal(job.status, "done", job.error ?? "");
    const t = await ticketByNumber(ORG, 81);
    assert.ok(t);
    assert.equal(t.status, "pending", "custom status falls back to Pending");
    assert.equal(t.fields["Order number"], "PO-9");
    assert.equal(t.fields.Priority, "High");
    assert.equal(t.fields.Group, "Tier 1");
    assert.equal(t.assigneeId, "user_ana");
    const msgs = await messagesOf(t.id);
    assert.deepEqual(msgs.map((m) => m.authorType), ["customer", "agent", "customer"]);
    const macros = await db.query.macros.findMany({ where: eq(schema.macros.orgId, ORG), orderBy: (m, { asc }) => [asc(m.name)] });
    assert.deepEqual(macros.map((m) => m.name), ["Escalate", "Thanks"]);
    assert.equal(macros[0].setStatus, "pending");
    assert.deepEqual(macros[0].addTags, ["urgent"]);
    assert.deepEqual(macros[0].notApplied, ["Set priority to Urgent"]);
    const rules = await db.query.rules.findMany({ where: eq(schema.rules.orgId, ORG) });
    assert.deepEqual(rules.map((r) => r.ifTag), ["billing"]);
  });
});

describe("Help Scout", () => {
  const ORG = "org_test_helpscout";
  const H = "https://api.helpscout.net/v2/";
  const routes = FIXTURES.helpscout.routes;

  test("imports conversations in order, saved replies and workflows by name", async () => {
    await newOrg(ORG);
    const job = await runToEnd(ORG, "helpscout", { appId: "a", appSecret: "b" }, fakeApi(H, routes));
    assert.equal(job.status, "done", job.error ?? "");
    const t = await ticketByNumber(ORG, 312);
    assert.ok(t);
    assert.equal(t.status, "closed");
    assert.equal(t.fields.Plan, "Business");
    assert.equal(t.fields.Inbox, "Support");
    const msgs = await messagesOf(t.id);
    assert.deepEqual(msgs.map((m) => m.body), ["It crashes on launch", "Fixed in 2.1"]);
    const macro = await db.query.macros.findFirst({ where: eq(schema.macros.orgId, ORG) });
    assert.equal(macro?.name, "Bug ack (Support)");
    assert.equal(macro?.body, "Thanks for the report, {%customer.firstName%}.");
    const kept = await db.query.importedRules.findMany({ where: eq(schema.importedRules.orgId, ORG) });
    assert.equal(kept[0]?.name, "Auto-tag bugs");
    const customer = await db.query.customers.findFirst({ where: and(eq(schema.customers.orgId, ORG), eq(schema.customers.email, "kim@lo.dev")) });
    assert.equal(customer?.fields["Other emails"], "kim@work.dev");
  });
});
