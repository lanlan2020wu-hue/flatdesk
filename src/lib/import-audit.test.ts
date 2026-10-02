// Import fixes from the deep audit: races, re-imports, unsafe text and links.
// Runs against a real Postgres like import/import.test.ts. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { db, pool, schema } from "@/db";
import { GAVE_UP, runStep, startImport } from "@/lib/import/engine";
import { BlockedUrl, readCapped, safeDownload } from "@/lib/import/download";
import { fakeApi, FIXTURES, type Routes } from "@/lib/import/fixtures";
import { makeGetter, type FetchLike } from "@/lib/import/http";
import { linkImportedAgent } from "@/lib/import/link";
import { csvCell } from "@/lib/import/report";
import { cleanText, cut, date, type SourceId } from "@/lib/import/types";

const Z = FIXTURES.zendesk.base;
const ZCREDS = FIXTURES.zendesk.creds;
const COMMENTS_4521 = "tickets/4521/comments.json?page[size]=100&include=users";

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
  await db.insert(schema.orgs).values({ id, name: "Audit team" });
  await db.insert(schema.agents).values({ orgId: id, userId: "user_ana", name: "Ana", email: "ana@acme.com", role: "admin" });
}

const zendeskTicket = (orgId: string) =>
  db.query.tickets.findFirst({ where: and(eq(schema.tickets.orgId, orgId), eq(schema.tickets.externalId, "zendesk:4521")) });
const messagesOf = (ticketId: string) =>
  db.query.messages.findMany({ where: eq(schema.messages.ticketId, ticketId), orderBy: (m, { asc }) => [asc(m.createdAt)] });

before(() => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must point at a test database");
});
after(async () => {
  await pool.end();
});

describe("starting an import", () => {
  test("two starts at the same moment make one import", async () => {
    const org = "org_audit_race";
    await newOrg(org);
    const api = fakeApi(Z, FIXTURES.zendesk.routes);
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => startImport({ orgId: org, userId: "user_ana", source: "zendesk", creds: ZCREDS, fetchImpl: api })),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    for (const r of results) if (r.status === "rejected") assert.match(String(r.reason?.message), /already running/);
    assert.equal(await db.$count(schema.imports, and(eq(schema.imports.orgId, org), eq(schema.imports.status, "running"))), 1);
  });

  test("Intercom workspaces are told apart by id, not by name", async () => {
    const org = "org_audit_intercom_key";
    await newOrg(org);
    const routes = (name: string, idCode: string): Routes => ({ ...FIXTURES.intercom.routes, me: { id: "1", type: "admin", app: { id_code: idCode, name } } });
    const first = await startImport({ orgId: org, userId: "user_ana", source: "intercom", creds: { token: "a" }, fetchImpl: fakeApi(FIXTURES.intercom.base, routes("Acme", "abc")) });
    const job = await db.query.imports.findFirst({ where: eq(schema.imports.id, first.id) });
    assert.equal(job?.accountKey, "abc");
    await db.update(schema.imports).set({ status: "done" }).where(eq(schema.imports.id, first.id));
    // Renamed workspace: same id, so it's allowed.
    const renamed = await startImport({ orgId: org, userId: "user_ana", source: "intercom", creds: { token: "a" }, fetchImpl: fakeApi(FIXTURES.intercom.base, routes("Acme Inc", "abc")) });
    await db.update(schema.imports).set({ status: "done" }).where(eq(schema.imports.id, renamed.id));
    // Another workspace with the same name: refused.
    await assert.rejects(
      startImport({ orgId: org, userId: "user_ana", source: "intercom", creds: { token: "b" }, fetchImpl: fakeApi(FIXTURES.intercom.base, routes("Acme", "xyz")) }),
      /already has an import/,
    );
    // A token whose workspace can't be told is refused.
    const noApp = { ...FIXTURES.intercom.routes, me: { id: "1", type: "admin" } };
    await assert.rejects(
      startImport({ orgId: "org_audit_intercom_key2", userId: "user_ana", source: "intercom", creds: { token: "c" }, fetchImpl: fakeApi(FIXTURES.intercom.base, noApp) }),
      /which workspace/,
    );
  });

  test("an unexpected error isn't shown to the admin as is", async () => {
    const api: FetchLike = async () => new Response("<html>secret upstream page</html>", { status: 200 });
    await assert.rejects(
      startImport({ orgId: "org_audit_err", userId: "user_ana", source: "zendesk", creds: ZCREDS, fetchImpl: api }),
      (e: Error) => !e.message.includes("secret") && /couldn't read/i.test(e.message),
    );
    const api500: FetchLike = async () => new Response("stack trace from upstream", { status: 500 });
    await assert.rejects(
      startImport({ orgId: "org_audit_err", userId: "user_ana", source: "zendesk", creds: ZCREDS, fetchImpl: api500 }),
      (e: Error) => !e.message.includes("stack trace") && /returned an error \(500\)/.test(e.message),
    );
  });
});

describe("re-importing", () => {
  const org = "org_audit_reimport";

  test("new messages are added after the team replied in Flatdesk", async () => {
    await newOrg(org);
    const routes = structuredClone(FIXTURES.zendesk.routes) as Routes;
    let job = await runToEnd(org, "zendesk", ZCREDS, fakeApi(Z, routes));
    assert.equal(job.status, "done", job.error ?? "");
    const t = await zendeskTicket(org);
    assert.ok(t);
    await db.insert(schema.messages).values({ orgId: org, ticketId: t.id, authorType: "agent", authorId: "user_ana", body: "Replied in Flatdesk" });

    const comments = routes[COMMENTS_4521] as { comments: object[] };
    comments.comments.push({ id: 4, author_id: 600, plain_body: "Thanks, got it.", public: true, created_at: "2024-01-04T09:00:00Z", attachments: [] });
    job = await runToEnd(org, "zendesk", ZCREDS, fakeApi(Z, routes));
    assert.equal(job.status, "done", job.error ?? "");
    const bodies = (await messagesOf(t.id)).map((m) => m.body);
    assert.equal(bodies.filter((b) => b.startsWith("I was charged twice.")).length, 1, "nothing is added twice");
    assert.ok(bodies.includes("Thanks, got it."), "the new message is added");
    assert.ok(bodies.includes("Replied in Flatdesk"));
    assert.equal(bodies.length, 5);
  });

  test("messages from an import that didn't record ids aren't added again", async () => {
    const t = await zendeskTicket(org);
    assert.ok(t);
    await db.update(schema.messages).set({ externalId: null }).where(eq(schema.messages.ticketId, t.id));
    const job = await runToEnd(org, "zendesk", ZCREDS, fakeApi(Z, structuredClone(FIXTURES.zendesk.routes) as Routes));
    assert.equal(job.status, "done", job.error ?? "");
    assert.equal((await messagesOf(t.id)).length, 5);
  });

  test("an agent joining takes only the tickets nobody picked up since", async () => {
    const phone = await db.query.tickets.findFirst({ where: and(eq(schema.tickets.orgId, org), eq(schema.tickets.externalId, "zendesk:1")) });
    assert.equal(phone?.pendingAssigneeEmail, "bo@acme.com");
    await db.update(schema.tickets).set({ assigneeId: "user_ana" }).where(eq(schema.tickets.id, phone!.id));
    await db.insert(schema.agents).values({ orgId: org, userId: "user_bo", name: "Bo", email: "bo@acme.com" });
    await linkImportedAgent(org, "user_bo", "bo@acme.com");
    const after = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, phone!.id) });
    assert.equal(after?.assigneeId, "user_ana", "the team's reassignment stands");
    assert.equal(after?.pendingAssigneeEmail, null);
    const rules = await db.query.rules.findMany({ where: and(eq(schema.rules.orgId, org), eq(schema.rules.assignTo, "user_bo")) });
    assert.deepEqual(rules.map((r) => r.ifTag), ["refund"]);
  });

  test("an email not on the agent's own row links nothing", async () => {
    await db.insert(schema.externalAgents).values({ orgId: org, source: "zendesk", externalId: "99", name: "Cy", email: "cy@acme.com" });
    await linkImportedAgent(org, "user_ana", "cy@acme.com");
    const cy = await db.query.externalAgents.findFirst({ where: and(eq(schema.externalAgents.orgId, org), eq(schema.externalAgents.externalId, "99")) });
    assert.equal(cy?.linkedUserId, null);
  });
});

describe("macros and rules", () => {
  test("re-importing updates macros and rules in place, and personal macros are internal", async () => {
    const org = "org_audit_macros";
    await newOrg(org);
    const routes = structuredClone(FIXTURES.zendesk.routes) as Routes;
    const macros = (routes["macros.json?page[size]=100"] as { macros: object[] }).macros;
    macros.push({
      id: 302,
      title: "x".repeat(300),
      active: true,
      restriction: { type: "User", id: 10 },
      actions: [{ field: "comment_value", value: "y".repeat(9000) }],
    });
    // A rule the team already made by hand for the same tag and agent.
    await db.insert(schema.rules).values({ orgId: org, ifTag: "vip", assignTo: "user_ana" });

    for (let run = 0; run < 2; run++) {
      const job = await runToEnd(org, "zendesk", ZCREDS, fakeApi(Z, routes));
      assert.equal(job.status, "done", job.error ?? "");
    }
    const rows = await db.query.macros.findMany({ where: eq(schema.macros.orgId, org), orderBy: (m, { asc }) => [asc(m.externalId)] });
    assert.deepEqual(rows.map((m) => [m.externalId, m.internal]), [["300", false], ["302", true]]);
    assert.equal(rows[1].name.length, 200);
    assert.equal(rows[1].body.length, 8000);
    const rules = await db.query.rules.findMany({ where: eq(schema.rules.orgId, org) });
    assert.deepEqual(rules.map((r) => r.ifTag), ["vip"], "the existing rule is reused, not duplicated");
    const kept = await db.query.importedRules.findFirst({ where: and(eq(schema.importedRules.orgId, org), eq(schema.importedRules.externalId, "trigger:400")) });
    assert.equal(kept?.flatdeskRuleId, rules[0].id);
  });
});

describe("unsafe input", () => {
  test("lone surrogates and NUL in text don't stop the import", async () => {
    const org = "org_audit_text";
    await newOrg(org);
    const routes = structuredClone(FIXTURES.zendesk.routes) as Routes;
    const c = (routes[COMMENTS_4521] as { comments: { plain_body: string }[] }).comments[0];
    c.plain_body = "Broken \uD83D emoji\u0000 here \uDE00 and fine 😀";
    const tickets = (routes["incremental/tickets/cursor.json?start_time=0"] as { tickets: { subject: string }[] }).tickets;
    tickets[0].subject = "Subject \uDBFF";
    const job = await runToEnd(org, "zendesk", ZCREDS, fakeApi(Z, routes));
    assert.equal(job.status, "done", job.error ?? "");
    const t = await zendeskTicket(org);
    assert.equal(t?.subject, "Subject �");
    assert.match((await messagesOf(t!.id))[0].body, /^Broken � emoji here � and fine 😀/);
  });

  test("text helpers", () => {
    assert.equal(cleanText("a\u0000b\uD800c"), "ab�c");
    assert.equal(cut("ab😀", 3), "ab", "a surrogate pair isn't split");
    assert.equal(date(Number.NaN, new Date(0)).getTime(), 0);
    assert.equal(date(1e20, new Date(0)).getTime(), 0);
    assert.equal(date("not a date", new Date(0)).getTime(), 0);
    assert.equal(date(1_700_000_000).toISOString(), "2023-11-14T22:13:20.000Z");
  });

  test("a page listing a record twice imports it once", async () => {
    const org = "org_audit_dupes";
    await newOrg(org);
    const routes = structuredClone(FIXTURES.zendesk.routes) as Routes;
    const page = routes["incremental/tickets/cursor.json?start_time=0"] as { tickets: object[] };
    page.tickets.push(page.tickets[0]);
    (routes["tags.json?page[size]=100"] as { tags: object[] }).tags.push({ name: "vip", count: 1 });
    const job = await runToEnd(org, "zendesk", ZCREDS, fakeApi(Z, routes));
    assert.equal(job.status, "done", job.error ?? "");
    assert.equal(await db.$count(schema.tickets, eq(schema.tickets.orgId, org)), 2);
  });

  test("issue CSV cells can't run as formulas", () => {
    assert.equal(csvCell("=HYPERLINK(\"x\")"), `"'=HYPERLINK(""x"")"`);
    for (const p of ["+", "-", "@", "\t", "\r"]) assert.equal(csvCell(`${p}1`), `"'${p}1"`);
    assert.equal(csvCell("plain"), `"plain"`);
    assert.equal(csvCell(null), `""`);
  });

  test("API calls go over https only", async () => {
    const api = fakeApi(Z, FIXTURES.zendesk.routes);
    assert.throws(() => makeGetter("http://acme.zendesk.com/api/v2/", {}, api));
    const get = makeGetter(Z, {}, api);
    await assert.rejects(get("http://acme.zendesk.com/api/v2/users/me.json"), /won't follow/);
    await assert.rejects(get("https://evil.example/users/me.json"), /won't follow/);
    assert.ok((await get("users/me.json")).data.user);
  });
});

describe("attachments", () => {
  const redirectTo = (location: string, calls: { url: string; auth: boolean }[]): FetchLike => async (url, init) => {
    calls.push({ url, auth: Boolean((init?.headers as Record<string, string>)?.Authorization) });
    if (url === "https://files.example/a") return new Response(null, { status: 302, headers: { location } });
    return new Response("file");
  };
  const auth = (u: URL) => (u.host === "files.example" ? { Authorization: "secret" } : ({} as Record<string, string>));

  test("redirects are checked hop by hop", async () => {
    const calls: { url: string; auth: boolean }[] = [];
    await assert.rejects(safeDownload(new URL("https://files.example/a"), auth, redirectTo("https://127.0.0.1/x", calls)), BlockedUrl);
    await assert.rejects(safeDownload(new URL("https://files.example/a"), auth, redirectTo("http://cdn.example/x", calls)), BlockedUrl);
    await assert.rejects(safeDownload(new URL("https://[::1]/a"), auth, redirectTo("", calls)), BlockedUrl);
    const res = await safeDownload(new URL("https://files.example/a"), auth, redirectTo("https://cdn.example/x", (calls.length = 0, calls)));
    assert.equal(await res.text(), "file");
    assert.deepEqual(calls, [
      { url: "https://files.example/a", auth: true },
      { url: "https://cdn.example/x", auth: false },
    ]);
    const loop: FetchLike = async () => new Response(null, { status: 302, headers: { location: "https://files.example/a" } });
    await assert.rejects(safeDownload(new URL("https://files.example/a"), auth, loop), /Too many redirects/);
  });

  test("downloads stop at the byte budget", async () => {
    const budget = { left: 10 };
    assert.equal(await readCapped(new Response("x".repeat(20)), 100, [budget]), null);
    assert.equal(budget.left, 10, "bytes of a file given up on are handed back");
    assert.equal((await readCapped(new Response("x".repeat(8)), 100, [budget]))?.length, 8);
    assert.equal(budget.left, 2);
    assert.equal(await readCapped(new Response("x".repeat(8)), 5, [{ left: 100 }]), null);
  });
});

describe("a record that keeps killing its step", () => {
  test("is skipped with an issue after a few tries", async () => {
    const org = "org_audit_stuck";
    await newOrg(org);
    const api = fakeApi(Z, FIXTURES.zendesk.routes);
    const { id } = await startImport({ orgId: org, userId: "user_ana", source: "zendesk", creds: ZCREDS, fetchImpl: api });
    // As if three steps had died on ticket 4521 while fetching its conversation.
    await db
      .update(schema.imports)
      .set({ phase: "ticket", cursor: { list: null, listed: true, tries: { "4521": 3 } } })
      .where(eq(schema.imports.id, id));
    await db.insert(schema.importRecords).values({ orgId: org, source: "zendesk", kind: "ticket", externalId: "4521", importId: id, raw: { id: 4521 }, pending: true });
    const job = await runStep(org, id, { fetchImpl: api, budgetMs: 5_000 });
    assert.equal(job?.status, "done", job?.error ?? "");
    const rec = await db.query.importRecords.findFirst({ where: and(eq(schema.importRecords.orgId, org), eq(schema.importRecords.externalId, "4521")) });
    assert.deepEqual(rec?.issues, [GAVE_UP]);
    assert.equal(rec?.pending, false);
    assert.ok(!api.calls.includes(COMMENTS_4521), "its conversation isn't fetched again");
    assert.equal(await db.$count(schema.importRecords, and(eq(schema.importRecords.orgId, org), eq(schema.importRecords.pending, true))), 0);
  });
});
