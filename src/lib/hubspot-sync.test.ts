// HubSpot write-back: closed tickets as notes on the contact (HTTP faked). Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { noteHtml } from "./integrations/hubspot-sync";

const ORG = "org_test_hubspot_sync";
const TOKEN = ["pat", "na1", "0".repeat(8), "0".repeat(4), "0".repeat(4), "0".repeat(4), "0".repeat(12)].join("-");

test("the note: subject, who handled it, their words, escaped", () => {
  const html = noteHtml({ number: 42, subject: "Refund <script>", status: "closed", assignee: "Sam & Co", messages: 3, firstMessage: "Please   refund\nmy order", resolvedByAi: false });
  assert.match(html, /Support ticket #42 closed<\/strong>: Refund &lt;script&gt;/);
  assert.match(html, /Handled by Sam &amp; Co\. 3 messages\./);
  assert.match(html, /They wrote: Please refund my order/);
  assert.match(html, /\/app\/tickets\/42">Open in Flatdesk/);
  assert.match(noteHtml({ number: 1, subject: "Hi", status: "closed", assignee: null, messages: 1, firstMessage: "x".repeat(900), resolvedByAi: true }), /Answered by the AI\. 1 message\.<\/p><p>They wrote: x{600}…/);
});

test("database: logs closed tickets once each, from when it was turned on, and adds missing contacts only if allowed", { skip: !process.env.DATABASE_URL }, async () => {
  const { db, schema } = await import("@/db");
  const { connectHubSpot } = await import("./integrations");
  const { saveHubSpotSettings, syncHubSpot, logTicketToHubSpot } = await import("./integrations/hubspot-sync");
  const { createTicket } = await import("./tickets");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Sync team", aiEnabled: false });

  const notes: { contact: string; body: string }[] = [];
  const created: string[] = [];
  let scopeOk = true;
  const fake = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url.endsWith("/account-info/v3/details")) return Response.json({ portalId: 5, companyName: "Acme" });
    if (url.includes("/crm/v3/objects/contacts?limit=1")) return Response.json({ results: [] });
    if (url.endsWith("/crm/v3/objects/contacts/search")) {
      const email = body.filterGroups[0].filters[0].value;
      return Response.json({ results: email === "known@x.com" || created.includes(email) ? [{ id: email === "known@x.com" ? "c1" : "c2", properties: {} }] : [] });
    }
    if (url.endsWith("/crm/v3/objects/contacts")) {
      created.push(body.properties.email);
      return Response.json({ id: "c2" });
    }
    if (url.endsWith("/crm/v3/objects/notes")) {
      if (!scopeOk) return new Response("", { status: 403 });
      assert.equal(body.associations[0].types[0].associationTypeId, 202);
      notes.push({ contact: body.associations[0].to.id, body: body.properties.hs_note_body });
      return Response.json({ id: `n${notes.length}` });
    }
    throw new Error(url);
  }) as typeof fetch;
  assert.ok("ok" in (await connectHubSpot(ORG, "user_admin", TOKEN, fake)));

  const closeIt = async (email: string, subject: string) => {
    const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: email, subject, body: `About ${subject}`, authorType: "customer" });
    await db.update(schema.tickets).set({ status: "closed", closedAt: new Date() }).where(eq(schema.tickets.id, t.id));
    return t;
  };
  const before = await closeIt("known@x.com", "Old one");

  // Off: nothing happens.
  assert.deepEqual(await syncHubSpot(new Date(), fake), { logged: 0 });

  await saveHubSpotSettings(ORG, { logClosed: true, createContacts: false }, new Date(Date.now() + 1000));
  const later = new Date(Date.now() + 5000);
  const known = await closeIt("known@x.com", "Billing question");
  await db.update(schema.tickets).set({ closedAt: later }).where(eq(schema.tickets.id, known.id));
  const stranger = await closeIt("new@x.com", "Hello");
  await db.update(schema.tickets).set({ closedAt: later }).where(eq(schema.tickets.id, stranger.id));

  assert.deepEqual(await syncHubSpot(later, fake), { logged: 1 });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].contact, "c1");
  assert.match(notes[0].body, /Billing question/);
  assert.deepEqual(created, [], "no contact made without permission");
  assert.deepEqual(await syncHubSpot(later, fake), { logged: 0 }, "once each");
  assert.equal((await db.query.tickets.findFirst({ where: eq(schema.tickets.id, before.id) }))?.crmLoggedAt, null, "closed before it was turned on");

  // Closed again after reopening: logged again.
  const again = new Date(later.getTime() + 60_000);
  await db.update(schema.tickets).set({ closedAt: again }).where(eq(schema.tickets.id, known.id));
  assert.deepEqual(await syncHubSpot(again, fake), { logged: 1 });

  // The button can add the contact.
  const r = await logTicketToHubSpot(ORG, stranger.id, { create: true, fetcher: fake });
  assert.deepEqual(r, { ok: true, created: true });
  assert.deepEqual(created, ["new@x.com"]);

  // A missing scope is recorded on the integration, not thrown.
  scopeOk = false;
  const fail = await logTicketToHubSpot(ORG, known.id, { fetcher: fake });
  assert.ok(!fail.ok && fail.reason === "error" && /contacts\.write/.test(fail.error ?? ""));
  const [row] = await db.select().from(schema.integrations).where(eq(schema.integrations.orgId, ORG));
  assert.match(row.lastError ?? "", /contacts\.write/);
});

after(async () => {
  if (!process.env.DATABASE_URL) return;
  const { db, schema, pool } = await import("@/db");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await pool.end();
});
