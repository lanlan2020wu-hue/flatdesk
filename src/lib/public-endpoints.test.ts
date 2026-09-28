// Chat visitors attaching files, and spam limits on the public endpoints. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq, like } from "drizzle-orm";

process.env.INBOUND_DOMAIN = "in.flatdesk.test";

const ORG = "org_test_public";
const KEY = "widgetpublic01";

after(async () => {
  const { pool } = await import("@/db");
  await pool.end();
});

async function freshOrg() {
  const { db, schema } = await import("@/db");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Public team", widgetKey: KEY, aiEnabled: false });
  await db.delete(schema.rateLimits).where(like(schema.rateLimits.key, "%"));
}

function multipart(url: string, fields: Record<string, string>, files: [string, string, string][], ip = "203.0.113.7") {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  for (const [name, type, text] of files) body.append("files", new File([text], name, { type }));
  return new Request(url, { method: "POST", body, headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });
}

test("a chat visitor can start with files and send more; the team sees them on the ticket", async () => {
  await freshOrg();
  const { db, schema } = await import("@/db");
  const { attachmentsByMessage } = await import("./attachments");
  const { readChatRequest, startConversation, validStart } = await import("./chat");
  // The start route's AI hand-off needs a live request, so its body is run here directly.
  const reply = (await import("@/app/api/chat/[key]/[number]/route")).POST;
  const params = <T,>(p: T) => ({ params: Promise.resolve(p) }) as never;

  const body = await readChatRequest(
    multipart("http://x/api/chat/k", { name: "Sam", email: "sam@example.com", message: "Screenshot of the error" }, [["error.png", "image/png", "png!"]]),
  );
  assert.ok(!("error" in body));
  const v = validStart(body.fields);
  assert.ok(!("error" in v));
  const { ticket: started, token } = await startConversation(ORG, v, body.files);
  const number = started.number;

  const r2 = await reply(multipart("http://x", { token }, [["log.txt", "text/plain", "trace"]]), params({ key: KEY, number: String(number) }));
  assert.equal(r2.status, 200, "a message can be just a file");
  const { messages } = await r2.json();
  assert.deepEqual(messages.map((m: { files: { name: string }[] }) => m.files.map((f) => f.name)), [["error.png"], ["log.txt"]]);
  assert.match(messages[1].files[0].url, new RegExp(`/api/chat/${KEY}/${number}/files/.+\\?t=`));

  const ticket = await db.query.tickets.findFirst({ where: eq(schema.tickets.orgId, ORG) });
  const rows = await db.query.messages.findMany({ where: eq(schema.messages.ticketId, ticket!.id) });
  const files = await attachmentsByMessage(ORG, rows.map((m) => m.id));
  assert.equal([...files.values()].flat().length, 2, "the agent's ticket view lists both files");

  const wrong = await reply(multipart("http://x", { token: "nope", message: "hi" }, [["x.txt", "text/plain", "x"]]), params({ key: KEY, number: String(number) }));
  assert.equal(wrong.status, 404, "a wrong token can't add files");
  const tooMany = await reply(
    multipart("http://x", { token }, Array.from({ length: 11 }, (_, i) => [`f${i}.txt`, "text/plain", "x"] as [string, string, string])),
    params({ key: KEY, number: String(number) }),
  );
  assert.equal(tooMany.status, 400);
  assert.match((await tooMany.json()).error, /up to 10 files per message/);
});

test("new chats are limited per visitor, and a filled hidden field marks a bot", async () => {
  await freshOrg();
  const { hit, ipKey, LIMITS, tooMany } = await import("./rate-limit");
  const { isBot } = await import("./chat");
  const req = (ip: string) => new Request("http://x", { headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });
  const chat = (ip: string) => hit(LIMITS.chatStart(ipKey(req(ip)), ORG));
  for (let i = 0; i < 5; i++) assert.equal((await chat("198.51.100.1")).ok, true);
  const blocked = await chat("198.51.100.1");
  assert.equal(blocked.ok, false);
  const res = tooMany(blocked.ok ? 0 : blocked.retryAfter);
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get("retry-after")) > 0);
  assert.match((await res.json()).error, /try again in 10 minutes/);
  assert.equal((await chat("198.51.100.2")).ok, true, "another visitor isn't affected");
  assert.notEqual(ipKey(req("198.51.100.1")), "198.51.100.1", "addresses are stored hashed");
  assert.equal(isBot({ website: "http://spam" }), true);
  assert.equal(isBot({ website: "" }), false);
});

test("limits reset after their window, and a hit can cost more than one", async () => {
  await freshOrg();
  const { hit } = await import("./rate-limit");
  const t0 = new Date("2026-10-01T00:00:00Z");
  const limit = { key: "test:window", max: 3, windowSec: 60 };
  assert.deepEqual(await hit([{ ...limit, cost: 3 }], t0), { ok: true });
  assert.deepEqual(await hit([limit], new Date(t0.getTime() + 10_000)), { ok: false, retryAfter: 50 });
  assert.deepEqual(await hit([limit], new Date(t0.getTime() + 61_000)), { ok: true }, "a new window starts");
  assert.deepEqual(await hit([{ ...limit, cost: 0 }], new Date(t0.getTime() + 62_000)), { ok: true }, "no files, no count");
});

test("the waitlist takes a few sign-ups per visitor and quietly drops bots", async () => {
  await freshOrg();
  const { db, schema } = await import("@/db");
  const { POST } = await import("@/app/api/waitlist/route");
  const join = (email: string, extra: Record<string, string> = {}) =>
    POST(
      new Request("http://x/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.9" },
        body: JSON.stringify({ email, ...extra }),
      }),
    );
  await db.delete(schema.waitlist).where(like(schema.waitlist.email, "%@wl-test.dev"));
  const bot = await join("bot@wl-test.dev", { website: "x" });
  assert.equal(bot.status, 200);
  assert.equal(await db.query.waitlist.findFirst({ where: eq(schema.waitlist.email, "bot@wl-test.dev") }), undefined);
  for (let i = 0; i < 5; i++) assert.equal((await join(`p${i}@wl-test.dev`)).status, 200);
  assert.equal((await join("p9@wl-test.dev")).status, 429);
});
