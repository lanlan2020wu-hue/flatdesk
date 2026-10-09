// Companies. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { companyDomain, guessCompanyName, normalizeCompanyDomain } from "./companies";

const ORG = "org_test_companies";

test("a company is the email's domain, but not a personal mailbox", () => {
  assert.equal(companyDomain("Jo@Acme.com"), "acme.com");
  assert.equal(companyDomain("sam@mail.acme-labs.co.uk"), "mail.acme-labs.co.uk");
  assert.equal(companyDomain("me@gmail.com"), null);
  assert.equal(companyDomain("me@iCloud.com"), null);
  assert.equal(companyDomain("nobody"), null);
  assert.equal(companyDomain(""), null);
  assert.equal(normalizeCompanyDomain("acme.com/../x"), null);
  assert.equal(guessCompanyName("acme-labs.co.uk"), "Acme Labs");
  assert.equal(guessCompanyName("acme.com"), "Acme");
});

if (process.env.DATABASE_URL) {
  after(async () => {
    const { db, schema, pool } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await pool.end();
  });

  test("database: tickets group by company, with notes the team saves", async () => {
    const { db, schema } = await import("@/db");
    await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
    await db.insert(schema.orgs).values({ id: ORG, name: "Flat" });
    const { createTicket } = await import("./tickets");
    const { companyTickets, getCompany, listCompanies, saveCompany, CompanyError } = await import("./companies");
    const mk = (email: string, subject: string) => createTicket({ orgId: ORG, channel: "email", customerEmail: email, customerName: null, subject, body: "Help", authorType: "customer" });

    const a = await mk("jo@acme.com", "Invoice wrong");
    await mk("sam@ACME.com", "Can't log in");
    await mk("jo@acme.com", "Add a seat");
    await mk("pat@gmail.com", "Where is my order");
    await mk("lee@globex.io", "Refund");

    const all = await listCompanies(ORG);
    assert.deepEqual(all.map((c) => c.domain).sort(), ["acme.com", "globex.io"], "personal mailboxes aren't companies");
    const acme = all.find((c) => c.domain === "acme.com")!;
    assert.equal(acme.people, 2);
    assert.equal(acme.tickets, 3);
    assert.equal(acme.open, 3);
    assert.equal(acme.name, "Acme");

    const others = await companyTickets(ORG, "acme.com", { exceptCustomer: a.customerId });
    assert.deepEqual(others.map((t) => t.subject), ["Can't log in"]);

    await saveCompany(ORG, "acme.com", { name: " Acme  Corp ", notes: "Annual plan. Ask for Dana." }, "Ada");
    const saved = await getCompany(ORG, "acme.com");
    assert.equal(saved?.name, "Acme Corp");
    assert.equal(saved?.notes, "Annual plan. Ask for Dana.");
    assert.equal(saved?.people.length, 2);
    assert.deepEqual((await listCompanies(ORG, "corp")).map((c) => c.domain), ["acme.com"], "search finds the saved name");
    await assert.rejects(saveCompany(ORG, "gmail.com", { name: "Google", notes: "" }, "Ada"), CompanyError);
    assert.equal(await getCompany(ORG, "nobody.example"), null);
  });
}
