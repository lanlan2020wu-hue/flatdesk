// The Slack app: install link, signed requests, alert buttons and replying from Slack (Slack faked). Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";

process.env.SLACK_CLIENT_ID = "1.2";
process.env.SLACK_CLIENT_SECRET = "client-secret";
process.env.SLACK_SIGNING_SECRET = "signing-secret";

const ORG = "org_test_slack_app";
const TEAM = "T_TEST_SLACK";

test("install state: tied to the admin, expires, can't be forged", async () => {
  const { installState, readState, installUrl } = await import("./integrations/slack");
  const now = Date.now();
  const st = installState("org_a", "user_a", now);
  assert.deepEqual(readState(st, now + 60_000), { orgId: "org_a", userId: "user_a" });
  assert.equal(readState(st, now + 16 * 60_000), null, "expired");
  const [body] = st.split(".");
  const forged = Buffer.from(JSON.stringify({ o: "org_b", u: "user_a", e: now + 60_000 })).toString("base64url");
  assert.equal(readState(`${forged}.${st.split(".")[1]}`, now), null);
  assert.equal(readState(`${body}.x`, now), null);
  assert.match(installUrl(st), /^https:\/\/slack\.com\/oauth\/v2\/authorize\?client_id=1\.2&scope=incoming-webhook%2Cusers%3Aread%2Cusers%3Aread\.email&redirect_uri=/);
});

test("requests from Slack: signature and freshness checked", async () => {
  const { verifySlackRequest } = await import("./integrations/slack");
  const body = "payload=%7B%7D";
  const ts = Math.floor(Date.now() / 1000);
  const sig = (t: number, b: string) => `v0=${createHmac("sha256", "signing-secret").update(`v0:${t}:${b}`).digest("hex")}`;
  const h = (t: number, s: string) => new Headers({ "x-slack-request-timestamp": String(t), "x-slack-signature": s });
  assert.ok(verifySlackRequest(h(ts, sig(ts, body)), body));
  assert.ok(!verifySlackRequest(h(ts, sig(ts, body)), `${body}x`), "body changed");
  assert.ok(!verifySlackRequest(h(ts - 600, sig(ts - 600, body)), body), "replayed");
  assert.ok(!verifySlackRequest(new Headers(), body));
});

test("alerts: Flatdesk's own Slack app gets buttons, other webhooks don't", async () => {
  const { buildRequest } = await import("./alerts");
  const { readReply } = await import("./integrations/slack");
  const p = { event: "ticket.created" as const, text: "New ticket for the team: #7 Refund <now> from a@b.c by email.", needsTeam: true, reason: null, sentAt: "", ticket: { number: 7, subject: "Refund <now>", channel: "email", status: "open", url: "https://x/app/tickets/7", customer: { name: null, email: "a@b.c" }, assignee: null } };
  const plain = JSON.parse(buildRequest("https://hooks.slack.com/services/T/B/x", "s", p).body);
  assert.equal(plain.blocks, undefined);
  const withButtons = JSON.parse(buildRequest("https://hooks.slack.com/services/T/B/x", "s", p, { ticketId: "tid" }).body);
  assert.match(withButtons.blocks[0].text.text, /<https:\/\/x\/app\/tickets\/7\|#7 Refund &lt;now&gt;>/);
  assert.deepEqual(withButtons.blocks[1].elements.map((e: { action_id: string; value?: string }) => [e.action_id, e.value]), [["reply", "tid"], ["assign_me", "tid"], ["open", undefined]]);
  assert.deepEqual(readReply({ body: { v: { value: " hi " } }, kind: { v: { selected_option: { value: "note" } } }, status: { v: { selected_option: { value: "bogus" } } } }), { body: "hi", internal: true, status: "pending" });
});

test("database: install, then Reply opens the form, sending it replies as the matching agent, Assign to me assigns", { skip: !process.env.DATABASE_URL }, async () => {
  const { db, schema } = await import("@/db");
  const { connectSlack, slackConnection, disconnect } = await import("./integrations");
  const { handleSlackInteraction } = await import("./integrations/slack-actions");
  const { createTicket } = await import("./tickets");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await db.insert(schema.orgs).values({ id: ORG, name: "Slack team", aiEnabled: false });
  await db.insert(schema.agents).values([
    { orgId: ORG, userId: "u_sam", name: "Sam", email: "Sam@slackteam.test", role: "agent" },
    { orgId: ORG, userId: "u_vi", name: "Vi", email: "vi@slackteam.test", role: "agent", viewer: true },
  ]);
  const hook = "https://hooks.slack.com/services/T/B/hook";
  assert.ok((await connectSlack(ORG, "u_sam", { token: "xoxb-1", teamId: TEAM, teamName: "Acme", channel: "#support", channelId: "C1", webhookUrl: hook })).ok);
  assert.equal((await db.query.orgs.findFirst({ where: eq(schema.orgs.id, ORG) }))?.alertWebhookUrl, hook, "alerts go to the picked channel");
  assert.equal((await slackConnection(TEAM))?.orgId, ORG);
  assert.ok((await connectSlack("org_someone_else", "u", { token: "x", teamId: TEAM, teamName: "Acme", channel: "#a", channelId: "C", webhookUrl: hook })).error, "one team per workspace");

  const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: "kim@example.com", subject: "Where is my order", body: "It's late.", authorType: "customer" });
  const views: unknown[] = [];
  const responses: Record<string, unknown>[] = [];
  const emails: Record<string, string> = { U_SAM: "sam@slackteam.test", U_VI: "vi@slackteam.test", U_NOBODY: "nobody@else.test" };
  const fake = (async (url: string, init?: RequestInit) => {
    if (url.startsWith("https://slack.com/api/users.info")) return Response.json({ ok: true, user: { profile: { email: emails[new URL(url).searchParams.get("user")!] } } });
    if (url === "https://slack.com/api/views.open") {
      views.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: true });
    }
    if (url.startsWith("https://hooks.slack.com/actions/")) {
      responses.push(JSON.parse(String(init?.body)));
      return new Response("ok");
    }
    throw new Error(url);
  }) as typeof fetch;
  const click = (user: string, action: string) => ({ type: "block_actions", team: { id: TEAM }, user: { id: user }, trigger_id: "trig", response_url: "https://hooks.slack.com/actions/1", actions: [{ action_id: action, value: t.id }], message: { blocks: [] } });

  // Reply opens the form with the customer's latest words.
  assert.deepEqual(await handleSlackInteraction(click("U_SAM", "reply"), fake), {});
  const modal = (views[0] as { view: { private_metadata: string; blocks: { text?: { text: string }; elements?: { text: string }[] }[] } }).view;
  assert.equal(JSON.parse(modal.private_metadata).t, t.id);
  assert.ok(JSON.stringify(modal.blocks).includes("It's late."));

  // Someone not on the team, or a viewer, is told why and nothing changes.
  for (const who of ["U_NOBODY", "U_VI"]) {
    const out = await handleSlackInteraction(click(who, "reply"), fake);
    await out.later?.();
    assert.equal(responses.at(-1)?.response_type, "ephemeral", who);
  }
  assert.equal(views.length, 1);

  // Sending the form: a reply as Sam, and the ticket set to pending.
  const submit = (values: object) => ({ type: "view_submission", team: { id: TEAM }, user: { id: "U_SAM" }, view: { callback_id: "flatdesk_reply", private_metadata: modal.private_metadata, state: { values } } });
  const empty = await handleSlackInteraction(submit({ body: { v: { value: " " } } }), fake);
  assert.deepEqual(empty.response, { response_action: "errors", errors: { body: "Write a message first." } });
  const sent = await handleSlackInteraction(submit({ body: { v: { value: "On its way today." } }, kind: { v: { selected_option: { value: "reply" } } }, status: { v: { selected_option: { value: "pending" } } } }), fake);
  assert.deepEqual(sent.response, { response_action: "clear" });
  await sent.later?.();
  const msgs = await db.select().from(schema.messages).where(eq(schema.messages.ticketId, t.id));
  const reply = msgs.find((m) => m.body === "On its way today.");
  assert.ok(reply && !reply.internal && reply.authorType === "agent" && reply.authorId === "u_sam");
  assert.equal((await db.query.tickets.findFirst({ where: eq(schema.tickets.id, t.id) }))?.status, "pending");
  assert.match(JSON.stringify(responses.at(-1)), /Sam replied from Slack/);

  // Assign to me.
  const assign = await handleSlackInteraction(click("U_SAM", "assign_me"), fake);
  await assign.later?.();
  assert.equal((await db.query.tickets.findFirst({ where: eq(schema.tickets.id, t.id) }))?.assigneeId, "u_sam");
  assert.match(JSON.stringify(responses.at(-1)), /Assigned to Sam from Slack/);

  // Another workspace's clicks are ignored.
  assert.deepEqual(await handleSlackInteraction({ ...click("U_SAM", "assign_me"), team: { id: "T_OTHER" } }, fake), {});

  // Disconnecting stops the alerts that went through the app.
  await disconnect(ORG, "slack");
  assert.equal((await db.query.orgs.findFirst({ where: eq(schema.orgs.id, ORG) }))?.alertWebhookUrl, null);
});

after(async () => {
  if (!process.env.DATABASE_URL) return;
  const { db, schema, pool } = await import("@/db");
  await db.delete(schema.orgs).where(eq(schema.orgs.id, ORG));
  await pool.end();
});
