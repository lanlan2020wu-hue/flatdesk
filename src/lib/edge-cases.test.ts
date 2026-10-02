// Odd input from URLs, emails and rating links, and rules that point at viewers. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";

process.env.INBOUND_DOMAIN = "in.flatdesk.test";

const ORG = "org_test_edges";
const KEY = "widgetedges01";

after(async () => {
  const { pool } = await import("@/db");
  await pool.end();
});

async function freshOrg() {
  const { db, schema } = await import("@/db");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Edge team", widgetKey: KEY, inboundKey: "edgestest1", aiEnabled: false });
  return { db, schema };
}

test("ticket numbers too big for Postgres, or not numbers at all, are no ticket instead of an error", async () => {
  const { parseTicketNumber } = await import("./tickets");
  assert.equal(parseTicketNumber("1042"), 1042);
  assert.equal(parseTicketNumber(7), 7);
  assert.equal(parseTicketNumber("2147483647"), 2147483647);
  for (const bad of ["2147483648", "99999999999", "0", "-3", "1.5", "1e3", "", " ", "abc", null, undefined]) {
    assert.equal(parseTicketNumber(bad), null, String(bad));
  }

  const { matchRecipient } = await import("./email");
  assert.deepEqual(matchRecipient(["edgestest1+99999999999@in.flatdesk.test"]), { key: "edgestest1", number: null });
  assert.deepEqual(matchRecipient(["edgestest1+12@in.flatdesk.test"]), { key: "edgestest1", number: 12 });

  await freshOrg();
  const { ticketForVisitor } = await import("./chat");
  assert.equal(await ticketForVisitor(ORG, "99999999999", "token"), null);

  const reply = (await import("@/app/api/chat/[key]/[number]/route")).POST;
  const r = await reply(
    new Request("http://x", { method: "POST", body: JSON.stringify({ token: "abc", message: "hi" }), headers: { "content-type": "application/json" } }),
    { params: Promise.resolve({ key: KEY, number: "99999999999" }) } as never,
  );
  assert.equal(r.status, 404);
});

test("a rating comment for a link that isn't a reply id is ignored", async () => {
  const { saveComment } = await import("./csat");
  await saveComment("not-a-uuid", "great help");
  const rate = (await import("@/app/api/rate/[id]/route")).POST;
  const r = await rate(
    new Request("http://x", { method: "POST", body: JSON.stringify({ comment: "hi" }), headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.99" } }),
    { params: Promise.resolve({ id: "not-a-uuid" }) } as never,
  );
  assert.equal(r.status, 200);
});

test("an assignment rule pointing at someone who is now a viewer doesn't give them tickets", async () => {
  const { db, schema } = await freshOrg();
  await db.insert(schema.agents).values([
    { orgId: ORG, userId: "u_viewer", name: "Vic", email: "vic@acme.com", role: "agent", viewer: true },
    { orgId: ORG, userId: "u_agent", name: "Ana", email: "ana@acme.com", role: "agent" },
  ]);
  await db.insert(schema.rules).values({ orgId: ORG, ifTag: "billing", assignTo: "u_viewer" });
  const { createTicket } = await import("./tickets");
  const base = { orgId: ORG, channel: "email" as const, customerEmail: "c@x.com", subject: "Invoice", body: "?", authorType: "customer" as const };

  const first = await createTicket({ ...base, tags: ["billing"] });
  assert.equal(first.assigneeId, null);

  // A later rule for a full agent still applies.
  await db.insert(schema.rules).values({ orgId: ORG, ifTag: "billing", assignTo: "u_agent", createdAt: new Date(Date.now() + 1000) });
  const second = await createTicket({ ...base, tags: ["billing"] });
  assert.equal(second.assigneeId, "u_agent");
});

test("only real uuids count as ids", async () => {
  const { isUuid } = await import("./ids");
  assert.equal(isUuid("3f2b8c1e-9a4d-4c6b-8e2f-1a2b3c4d5e6f"), true);
  for (const bad of ["0".repeat(36), "-".repeat(36), "3f2b8c1e9a4d4c6b8e2f1a2b3c4d5e6f", "abc", "", null]) assert.equal(isUuid(bad), false, String(bad));
  const { loadAttachment } = await import("./attachments");
  assert.equal(await loadAttachment(ORG, "-".repeat(36)), null);
});

test("help center addresses and searches with a NUL byte find nothing instead of failing", async () => {
  const { orgByHelpSlug, publishedArticle, searchArticles } = await import("./help");
  assert.equal(await orgByHelpSlug("acme\0"), undefined);
  assert.equal(await publishedArticle(ORG, "refunds\0"), undefined);
  assert.deepEqual(await searchArticles(ORG, "\0"), []);
});

test("a picked help center address follows the 3 to 40 character rule", async () => {
  const { db, schema } = await freshOrg();
  const { ensureHelpSlug, validHelpSlug } = await import("./help");
  for (const name of ["AB", "A very long team name that keeps going well past forty characters"]) {
    await db.update(schema.orgs).set({ name, helpSlug: null }).where(eq(schema.orgs.id, ORG));
    const slug = await ensureHelpSlug(ORG);
    assert.ok(validHelpSlug(slug), slug);
  }
});

test("a team open one hour a week still gets a due time inside its hours", async () => {
  const { dueAt } = await import("./sla");
  const mondays = { tz: "UTC", days: [1], start: 9 * 60, end: 10 * 60 };
  // 24 open hours is 24 Mondays from Monday 2026-09-28 9:00.
  assert.equal(dueAt(new Date("2026-09-28T09:00:00Z"), 1440, mondays).toISOString(), "2027-03-08T10:00:00.000Z");
});

test("a rewrite style must be one of the real styles", async () => {
  const { rewriteText, CopilotError } = await import("./copilot");
  await assert.rejects(rewriteText(ORG, "u1", null, "hello", "constructor" as never), (e) => e instanceof CopilotError && /Unknown rewrite style/.test(e.message));
});

test("team names in the From line stay one quoted sender", async () => {
  const { fromAddress } = await import("./email");
  assert.equal(fromAddress("Acme, Inc", "support@mail.flatdesk.test"), '"Acme, Inc" <support@mail.flatdesk.test>');
  assert.equal(fromAddress('Bank <alerts@bank.com>', "s@m.test"), '"Bank alerts bank.com" <s@m.test>');
  assert.equal(fromAddress('Say "hi"\r\nBcc: x@y.z', "s@m.test"), '"Say hi Bcc: x y.z" <s@m.test>');
  assert.equal(fromAddress("<>", "s@m.test"), "s@m.test");
});
