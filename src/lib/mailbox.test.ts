// A team's own Gmail mailbox: reading new mail and sending replies.
// Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { newInboxMessages, readGmailMessage, type GmailMessage } from "./mailbox/gmail";
<<<<<<< HEAD
import type { GraphMessage } from "./mailbox/microsoft";
=======
>>>>>>> origin/main
import { addressHeader, buildMime, encodeWord, splitAddresses } from "./mailbox/mime";

const ORG = "org_mailbox_test";
const b64 = (s: string) => Buffer.from(s).toString("base64url");

test("mime: headers encoded, parts and files laid out", () => {
  assert.equal(encodeWord("Hello"), "Hello");
  assert.equal(encodeWord("Café"), `=?UTF-8?B?${Buffer.from("Café").toString("base64")}?=`);
  assert.equal(encodeWord("a\r\nBcc: x@y.z"), "a Bcc: x@y.z");
  assert.equal(addressHeader("Acme", "s@acme.test"), '"Acme" <s@acme.test>');
  assert.match(addressHeader("Café Ünï", "s@acme.test"), /^=\?UTF-8\?B\?.+\?= <s@acme\.test>$/);
  let n = 0;
  const raw = buildMime(
    {
      from: '"Acme" <s@acme.test>',
      to: "c@example.test",
      cc: ["d@example.test"],
      subject: "Re: Où est ma commande",
      text: "Hi\nthere",
      html: "<p>Hi</p>",
      headers: { "In-Reply-To": "<a@b>", "Bad Header": "x", Evil: "a\r\nBcc: z@z.z" },
      attachments: [{ filename: 'inv"oice é.pdf', contentType: "application/pdf", content: Buffer.from("PDF") }],
    },
    () => `b${++n}`,
  );
  assert.match(raw, /^From: "Acme" <s@acme\.test>\r\nTo: c@example\.test\r\nCc: d@example\.test\r\nSubject: =\?UTF-8\?B\?/);
  assert.match(raw, /\r\nIn-Reply-To: <a@b>\r\n/);
  assert.match(raw, /\r\nEvil: a Bcc: z@z\.z\r\n/, "no header injection");
  assert.doesNotMatch(raw, /Bad Header/);
  assert.match(raw, /Content-Type: multipart\/mixed; boundary="b2"/);
  assert.match(raw, /--b1\r\nContent-Type: text\/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\nSGkKdGhlcmU=/);
  assert.match(raw, /filename="inv_oice _\.pdf"; filename\*=UTF-8''inv_oice%20%C3%A9\.pdf/);
  assert.ok(raw.trimEnd().endsWith("--b2--"));
  assert.deepEqual(splitAddresses('"Doe, Jane" <jane@x.test>, bob@y.test,  <c@z.test>'), ['"Doe, Jane" <jane@x.test>', "bob@y.test", "<c@z.test>"]);
  assert.deepEqual(splitAddresses(undefined), []);
});

const message = (id: string, from: string, subject: string, extra: { name: string; value: string }[] = []): GmailMessage => ({
  id,
  threadId: `t_${id}`,
  labelIds: ["INBOX"],
  payload: {
    mimeType: "multipart/mixed",
    headers: [
      { name: "From", value: from },
      { name: "To", value: "support@acme.test" },
      { name: "Cc", value: "Boss <boss@client.test>, support@acme.test" },
      { name: "Subject", value: subject },
      { name: "Message-ID", value: `<${id}@mail.client.test>` },
      { name: "Authentication-Results", value: "mx.google.com; dmarc=pass" },
      ...extra,
    ],
    parts: [
      { mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: b64(`Body of ${id}`) } }, { mimeType: "text/html", body: { data: b64("<p>html</p>") } }] },
      { mimeType: "application/pdf", filename: "receipt.pdf", headers: [{ name: "Content-Disposition", value: "attachment" }], body: { attachmentId: "att1", size: 3 } },
      { mimeType: "image/png", filename: "logo.png", headers: [{ name: "Content-Disposition", value: "inline" }], body: { data: b64("png"), size: 3 } },
    ],
  },
});

test("readGmailMessage: text, html, files and headers", () => {
  const m = readGmailMessage(message("m1", "Jane <jane@client.test>", "Help"));
  assert.equal(m.text, "Body of m1");
  assert.equal(m.html, "<p>html</p>");
  assert.equal(m.header("message-id"), "<m1@mail.client.test>");
  assert.deepEqual(
    m.files.map((f) => [f.filename, f.inline]),
    [["receipt.pdf", false], ["logo.png", true]],
  );
});

// A stand-in for Google's APIs.
function fakeGoogle(state: { history: { id: string; messagesAdded: { message: { id: string; labelIds: string[] } }[] }[]; messages: Record<string, GmailMessage>; sent: string[]; historyGone?: boolean }) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.host === "oauth2.googleapis.com" && url.pathname === "/token") {
      const p = new URLSearchParams(String(init?.body));
      if (p.get("grant_type") === "authorization_code") return json({ access_token: "acc1", refresh_token: "ref1", expires_in: 3600, scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send" });
      return json({ access_token: "acc2", expires_in: 3600 });
    }
    if (url.host === "oauth2.googleapis.com" && url.pathname === "/revoke") return json({});
    const path = url.pathname.replace("/gmail/v1/users/me", "");
    if (path === "/profile") return json({ emailAddress: "Support@Acme.test", historyId: "100" });
    if (path === "/history") {
      if (state.historyGone) return json({ error: { message: "not found" } }, 404);
      const start = Number(url.searchParams.get("startHistoryId"));
      const history = state.history.filter((h) => Number(h.id) > start);
      return json({ history, historyId: history.at(-1)?.id ?? String(start) });
    }
    const att = /^\/messages\/([^/]+)\/attachments\/(.+)$/.exec(path);
    if (att) return json({ data: b64("PDF"), size: 3 });
    if (path === "/messages/send") {
      const raw = Buffer.from(JSON.parse(String(init?.body)).raw, "base64url").toString();
      state.sent.push(raw);
      return json({ id: `sent${state.sent.length}`, threadId: "t" });
    }
    const msg = /^\/messages\/([^/]+)$/.exec(path);
    if (msg && msg[1].startsWith("sent")) return json({ id: msg[1], payload: { headers: [{ name: "Message-ID", value: `<gmail-${msg[1]}@mail.gmail.com>` }] } });
    if (msg && state.messages[msg[1]]) return json(state.messages[msg[1]]);
    return json({ error: { message: `no route ${path}` } }, 404);
  }) as typeof fetch;
}

test("newInboxMessages: inbox additions only, in order, with the next start", async () => {
  const state = {
    history: [
      { id: "101", messagesAdded: [{ message: { id: "a", labelIds: ["INBOX", "UNREAD"] } }] },
      { id: "102", messagesAdded: [{ message: { id: "s", labelIds: ["SENT"] } }, { message: { id: "b", labelIds: ["INBOX"] } }] },
      { id: "103", messagesAdded: [{ message: { id: "x", labelIds: ["SPAM", "INBOX"] } }, { message: { id: "a", labelIds: ["INBOX"] } }] },
    ],
    messages: {},
    sent: [] as string[],
    historyGone: false,
  };
  const f = fakeGoogle(state);
  assert.deepEqual(await newInboxMessages("acc", "100", f), { ids: ["a", "b"], historyId: "103" });
  assert.deepEqual(await newInboxMessages("acc", "100", f, 1), { ids: ["a"], historyId: "101" }, "stops early and resumes from where it stopped");
  state.historyGone = true;
  assert.deepEqual(await newInboxMessages("acc", "50", f), { ids: [], historyId: "100", expired: true });
});

test("a connected Gmail mailbox: new mail becomes tickets, replies go out from it", async (t) => {
  if (!process.env.DATABASE_URL) return t.skip("needs DATABASE_URL");
  const { db, schema } = await import("@/db");
  const { connectGmail, disconnectMailbox, mailboxFor, pollMailbox, sendFromMailbox } = await import("./mailbox");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Acme Café", inboundKey: "mbox00001" });
  const state = {
    history: [
      { id: "101", messagesAdded: [{ message: { id: "m1", labelIds: ["INBOX"] } }] },
      { id: "102", messagesAdded: [{ message: { id: "m2", labelIds: ["INBOX"] } }] },
    ],
    messages: {
      m1: message("m1", "Jane <jane@client.test>", "Where is my order?"),
      m2: message("m2", "support@acme.test", "Our own copy"),
    } as Record<string, GmailMessage>,
    sent: [] as string[],
  };
  const f = fakeGoogle(state);

  assert.deepEqual(await connectGmail(ORG, "user_1", "code", f), { address: "support@acme.test" });
  let row = (await mailboxFor(ORG))!;
  assert.equal(row.settings.historyId, "100", "starts from now");

  const found = await pollMailbox(row, f);
  assert.equal(found.length, 1, "the team's own mail is skipped");
  const ticket = (await db.query.tickets.findFirst({ where: eq(schema.tickets.id, found[0].ticketId) }))!;
  assert.equal(ticket.subject, "Where is my order?");
  assert.deepEqual(ticket.cc, ["boss@client.test"], "copies the boss, not the mailbox itself");
  const files = await db.select().from(schema.attachments).where(eq(schema.attachments.ticketId, ticket.id));
  assert.deepEqual(files.map((x) => x.filename), ["receipt.pdf"], "logo-sized inline images are dropped");
  row = (await mailboxFor(ORG))!;
  assert.equal(row.settings.historyId, "102");
  assert.equal(row.lastError, null);

  // Nothing new: nothing happens. The same message again (Gmail repeats history): one message.
  assert.equal((await pollMailbox(row, f)).length, 0);
  assert.equal((await pollMailbox({ ...row, settings: { ...row.settings, historyId: "100" } }, f)).filter((x) => x.action === "created").length, 0);

  // Sending: from the mailbox, threaded, and the Message-ID Gmail gave is kept.
  const sent = await sendFromMailbox(row, { fromName: "Acme Café", to: "jane@client.test", subject: "Re: Where is my order?", text: "On its way", html: "<p>On its way</p>", headers: { "In-Reply-To": "<m1@mail.client.test>" } }, f);
  assert.deepEqual(sent, { messageId: "<gmail-sent1@mail.gmail.com>" });
  assert.match(state.sent[0], /^From: =\?UTF-8\?B\?[^?]+\?= <support@acme\.test>\r\n/);
  assert.match(state.sent[0], /\r\nIn-Reply-To: <m1@mail\.client\.test>\r\n/);

  // Access revoked in Google: shown on the connection.
  const broken = (async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as unknown as typeof fetch;
  const expired = { ...row, credentials: (await import("./import/crypto")).seal({ refresh: "r", access: "a", expires: new Date(0).toISOString() }) };
  assert.deepEqual(await pollMailbox(expired, broken), []);
  assert.match((await mailboxFor(ORG))!.lastError ?? "", /expired or was revoked/);

  await disconnectMailbox(ORG, f);
  assert.equal(await mailboxFor(ORG), null);
});

<<<<<<< HEAD
// A stand-in for Microsoft's sign-in and Graph.
function fakeMicrosoft(state: { inbox: GraphMessage[]; calls: string[]; posted: Record<string, unknown>[] }) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const method = init?.method ?? "GET";
    if (url.host === "login.microsoftonline.com") return json({ access_token: "msacc", refresh_token: "msref", expires_in: 3600, scope: "User.Read Mail.ReadWrite Mail.Send" });
    const path = url.pathname.replace("/v1.0/me", "");
    state.calls.push(`${method} ${path}`);
    if (path === "" ) return json({ mail: "Help@Contoso.test", userPrincipalName: "help@contoso.test" });
    if (path === "/mailFolders/inbox/messages") {
      const since = /receivedDateTime ge (\S+)/.exec(url.searchParams.get("$filter") ?? "")![1];
      return json({ value: state.inbox.filter((m) => m.receivedDateTime >= since) });
    }
    if (/^\/messages\/[^/]+\/attachments$/.test(path) && method === "GET") {
      return json({ value: [{ "@odata.type": "#microsoft.graph.fileAttachment", name: "photo.jpg", contentType: "image/jpeg", size: 40000, isInline: false, contentBytes: Buffer.from("JPG").toString("base64") }] });
    }
    if (path === "/messages" && method === "GET") return json({ value: url.searchParams.get("$filter")?.includes("<ms1@contoso-client.test>") ? [{ id: "ms1" }] : [] });
    if (path === "/messages/ms1/createReply") return json({ id: "draft1" });
    if (path === "/messages" && method === "POST") return json({ id: "draft2" });
    if (/^\/messages\/draft\d$/.test(path) && method === "PATCH") {
      state.posted.push(JSON.parse(String(init?.body)));
      return json({});
    }
    if (/^\/messages\/draft\d\/attachments$/.test(path)) return json({ id: "a" }, 201);
    if (/^\/messages\/draft\d$/.test(path)) return json({ internetMessageId: `<${path.split("/")[2]}@contoso.test>` });
    if (/^\/messages\/draft\d\/send$/.test(path)) return new Response(null, { status: 202 });
    return json({ error: { message: `no route ${method} ${path}` } }, 404);
  }) as typeof fetch;
}

test("a connected Outlook mailbox: new mail becomes tickets, replies thread on the customer's message", async (t) => {
  if (!process.env.DATABASE_URL) return t.skip("needs DATABASE_URL");
  const { db, schema } = await import("@/db");
  const { connectGmail, connectMicrosoft, mailboxFor, pollMailbox, sendFromMailbox } = await import("./mailbox");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Contoso", inboundKey: "mbox00001" });
  // Connected to Gmail first; connecting Outlook replaces it.
  await connectGmail(ORG, "user_1", "code", fakeGoogle({ history: [], messages: {}, sent: [] }));
  const state = {
    inbox: [
      {
        id: "ms1",
        receivedDateTime: "2026-10-08T10:05:00Z",
        subject: "Refund please",
        from: { emailAddress: { name: "Ann", address: "ann@contoso-client.test" } },
        toRecipients: [{ emailAddress: { address: "help@contoso.test" } }],
        ccRecipients: [{ emailAddress: { name: "Bo", address: "bo@contoso-client.test" } }],
        internetMessageId: "<ms1@contoso-client.test>",
        internetMessageHeaders: [{ name: "Authentication-Results", value: "spf=pass; dmarc=pass" }],
        body: { contentType: "text" as const, content: "I was charged twice" },
        hasAttachments: true,
      },
    ] as GraphMessage[],
    calls: [] as string[],
    posted: [] as Record<string, unknown>[],
  };
  const f = fakeMicrosoft(state);
  assert.deepEqual(await connectMicrosoft(ORG, "user_1", "code", f, new Date("2026-10-08T10:00:00Z")), { address: "help@contoso.test" });
  const row = (await mailboxFor(ORG))!;
  assert.equal(row.kind, "microsoft");
  assert.equal((await db.select().from(schema.integrations).where(eq(schema.integrations.orgId, ORG))).length, 1, "one mailbox per team");

  const found = await pollMailbox(row, f);
  assert.equal(found.length, 1);
  const ticket = (await db.query.tickets.findFirst({ where: eq(schema.tickets.id, found[0].ticketId) }))!;
  assert.equal(ticket.subject, "Refund please");
  assert.deepEqual(ticket.cc, ["bo@contoso-client.test"]);
  assert.equal((await db.select().from(schema.attachments).where(eq(schema.attachments.ticketId, ticket.id))).length, 1);
  const after1 = (await mailboxFor(ORG))!;
  assert.equal(after1.settings.since, "2026-10-08T10:05:00Z");
  // The last message comes back on the next run (>=) and is recognised as already in.
  assert.equal((await pollMailbox(after1, f)).length, 0);

  const sent = await sendFromMailbox(after1, { fromName: "Contoso", to: "ann@contoso-client.test", cc: ["bo@contoso-client.test"], subject: "Re: Refund please", text: "Done", html: "<p>Done</p>", headers: { "In-Reply-To": "<ms1@contoso-client.test>", "X-Flatdesk-Org": ORG }, attachments: [{ filename: "r.pdf", contentType: "application/pdf", content: Buffer.from("x") }] }, f);
  assert.deepEqual(sent, { messageId: "<draft1@contoso.test>" });
  assert.ok(state.calls.includes("POST /messages/ms1/createReply"), "replies on the customer's own message");
  assert.ok(state.calls.includes("POST /messages/draft1/attachments"));
  assert.ok(state.calls.includes("POST /messages/draft1/send"));
  assert.deepEqual(state.posted[0], { subject: "Re: Refund please", body: { contentType: "html", content: "<p>Done</p>" }, toRecipients: [{ emailAddress: { address: "ann@contoso-client.test" } }], ccRecipients: [{ emailAddress: { address: "bo@contoso-client.test" } }] });

  // Not in the mailbox (say, it came by forwarding): a new message.
  const fresh = await sendFromMailbox(after1, { fromName: "Contoso", to: "zed@x.test", subject: "Hi", text: "Hi", html: "Hi", headers: { "In-Reply-To": "<other@x.test>" } }, f);
  assert.deepEqual(fresh, { messageId: "<draft2@contoso.test>" });
});

=======
>>>>>>> origin/main
after(async () => {
  if (!process.env.DATABASE_URL) return;
  const { db, schema, pool } = await import("@/db");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await pool.end();
});
