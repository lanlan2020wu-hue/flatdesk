// Replies from the team's own address. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { isDomainRefusal, senderAddress } from "./email";
import { parseSendAddress, SendDomainError, UNVERIFIED_HOLD_MS } from "./send-domain";

const A = "org_send_domain_a";
const B = "org_send_domain_b";

test("parseSendAddress: own domains only", () => {
  assert.deepEqual(parseSendAddress(" Support@Acme.com "), { address: "support@acme.com", domain: "acme.com" });
  assert.deepEqual(parseSendAddress("help@mail.acme.co.uk"), { address: "help@mail.acme.co.uk", domain: "mail.acme.co.uk" });
  for (const bad of ["", "acme.com", "support@", "a..b@acme.com", "support@acme", "x@1.2.3.4", "me@gmail.com", "team@outlook.com", "s@acme..com", "s p@acme.com", "x@-acme.com"]) {
    assert.equal(parseSendAddress(bad), null, bad);
  }
});

test("senderAddress: the team's own only once verified", () => {
  const shared = process.env.EMAIL_FROM;
  assert.equal(senderAddress({ sendAddress: "support@acme.com", sendDomainVerifiedAt: null }), shared);
  assert.equal(senderAddress({ sendAddress: "support@acme.com", sendDomainVerifiedAt: new Date() }), "support@acme.com");
  assert.equal(senderAddress({ sendAddress: null, sendDomainVerifiedAt: null }), shared);
  assert.ok(isDomainRefusal("The acme.com domain is not verified. Please, add and verify your domain"));
  assert.ok(!isDomainRefusal("Invalid `to` field"));
});

// A stand-in for Resend's domains API that records what was asked.
function fakeDomains(status = "not_started") {
  const calls: string[] = [];
  let n = 0;
  const record = (s: string) => [
    { record: "SPF", type: "MX", name: "send", value: "feedback-smtp.us-east-1.amazonses.com", priority: 10, ttl: "Auto", status: s },
    { record: "SPF", type: "TXT", name: "send", value: "v=spf1 include:amazonses.com ~all", ttl: "Auto", status: s },
    { record: "DKIM", type: "TXT", name: "resend._domainkey", value: "p=MIGf", ttl: "Auto", status: s },
  ];
  const api = {
    calls,
    status,
    create: async ({ name }: { name: string }) => {
      calls.push(`create ${name}`);
      return { data: { id: `dom_${++n}`, name, status: "not_started", records: record("not_started") }, error: null };
    },
    get: async (id: string) => {
      calls.push(`get ${id}`);
      return { data: { id, status: api.status, records: record(api.status === "verified" ? "verified" : "pending") }, error: null };
    },
    verify: async (id: string) => {
      calls.push(`verify ${id}`);
      return { data: { id }, error: null };
    },
    remove: async (id: string) => {
      calls.push(`remove ${id}`);
      return { data: { id }, error: null };
    },
  };
  return api;
}

test("setting up, verifying, sharing and removing a sending domain", async (t) => {
  if (!process.env.DATABASE_URL) return t.skip("needs DATABASE_URL");
  const { db, schema } = await import("@/db");
  const { checkSendDomain, setSendAddress } = await import("./send-domain");
  await db.delete(schema.orgs).where(inArray(schema.orgs.id, [A, B]));
  await db.insert(schema.orgs).values([
    { id: A, name: "Acme", inboundKey: "sdoma0001" },
    { id: B, name: "Not Acme", inboundKey: "sdomb0001" },
  ]);
  const fake = fakeDomains();
  const domains = fake as never;
  const t0 = new Date("2026-10-01T00:00:00Z");

  const set = await setSendAddress(A, "Support@Acme.test", { now: t0, domains });
  assert.equal(set?.records.length, 3);
  let a = (await db.query.orgs.findFirst({ where: eq(schema.orgs.id, A) }))!;
  assert.equal(a.sendAddress, "support@acme.test");
  assert.equal(a.sendDomainVerifiedAt, null);
  assert.equal(senderAddress(a), process.env.EMAIL_FROM, "not until verified");

  // Another team can't take it while it's being set up...
  await assert.rejects(setSendAddress(B, "help@acme.test", { now: new Date(t0.getTime() + 3600_000), domains }), SendDomainError);
  // ...but can once the first team left it unfinished for days.
  await setSendAddress(B, "help@acme.test", { now: new Date(t0.getTime() + UNVERIFIED_HOLD_MS + 60_000), domains });
  a = (await db.query.orgs.findFirst({ where: eq(schema.orgs.id, A) }))!;
  assert.equal(a.sendDomain, null);
  assert.ok(fake.calls.includes("remove dom_1"));

  // Verified: replies switch over, and the domain is the team's to keep.
  assert.equal(await checkSendDomain(B, { domains }), "pending");
  fake.status = "verified";
  assert.equal(await checkSendDomain(B, { domains }), "verified");
  let b = (await db.query.orgs.findFirst({ where: eq(schema.orgs.id, B) }))!;
  assert.equal(senderAddress(b), "help@acme.test");
  assert.ok(b.sendDomainRecords?.every((r) => r.status === "verified"));
  await assert.rejects(setSendAddress(A, "x@acme.test", { now: new Date(t0.getTime() + 30 * UNVERIFIED_HOLD_MS), domains }), /another Flatdesk team/);

  // A new mailbox name on the same domain needs no new records.
  const creates = fake.calls.filter((c) => c.startsWith("create")).length;
  await setSendAddress(B, "billing@acme.test", { domains });
  b = (await db.query.orgs.findFirst({ where: eq(schema.orgs.id, B) }))!;
  assert.equal(b.sendAddress, "billing@acme.test");
  assert.ok(b.sendDomainVerifiedAt);
  assert.equal(fake.calls.filter((c) => c.startsWith("create")).length, creates);

  // Removing it goes back to the shared address.
  await setSendAddress(B, null, { domains });
  b = (await db.query.orgs.findFirst({ where: eq(schema.orgs.id, B) }))!;
  assert.equal(b.sendAddress, null);
  assert.equal(senderAddress(b), process.env.EMAIL_FROM);
  assert.ok(fake.calls.includes("remove dom_2"));
});

after(async () => {
  if (!process.env.DATABASE_URL) return;
  const { db, schema, pool } = await import("@/db");
  await db.delete(schema.orgs).where(inArray(schema.orgs.id, [A, B]));
  await pool.end();
});
