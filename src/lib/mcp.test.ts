// Flatdesk's MCP server: the handshake, the tool list, and tools working a
// ticket through the same code as the REST API. Run: DATABASE_URL=... npm test
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";

const ORG = "org_test_mcp";
const OTHER = "org_test_mcp_other";

after(async () => {
  const { pool } = await import("@/db");
  await pool.end();
});

test("MCP: handshake, tools, and working a ticket with an API key", async () => {
  const { db, schema } = await import("@/db");
  for (const id of [ORG, OTHER]) {
    await db.delete(schema.orgs).where(eq(schema.orgs.id, id));
    await db.insert(schema.orgs).values({ id, name: id, aiEnabled: false });
  }
  await db.insert(schema.agents).values({ orgId: ORG, userId: "u_ada", name: "Ada", email: "ada@acme.test", role: "admin" });
  const { createTicket } = await import("./tickets");
  const { createApiKey } = await import("./api-keys");
  const t = await createTicket({ orgId: ORG, channel: "email", customerEmail: "kim@example.com", subject: "Parcel crushed", body: "The box arrived crushed", authorType: "customer" });
  const theirs = await createTicket({ orgId: OTHER, channel: "email", customerEmail: "kim@example.com", subject: "Parcel crushed", body: "crushed", authorType: "customer" });
  const made = await createApiKey(ORG, "u_ada", "Claude");
  assert.ok("key" in made);

  const route = await import("@/app/api/mcp/route");
  let id = 0;
  const call = async (method: string, params?: unknown, key = made.key, notify = false) => {
    const res = await route.POST(
      new Request("http://x/api/mcp", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", ...(notify ? {} : { id: ++id }), method, params }),
      }),
    );
    return { status: res.status, body: res.status === 202 ? null : await res.json() };
  };
  const tool = async (name: string, args: Record<string, unknown>) => (await call("tools/call", { name, arguments: args })).body.result;

  assert.equal((await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } }, "fd_nope_nope_nope_nope_nope")).status, 401);
  const init = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  assert.equal(init.body.result.protocolVersion, "2025-06-18");
  assert.equal(init.body.result.serverInfo.name, "flatdesk");
  assert.equal((await call("notifications/initialized", undefined, made.key, true)).status, 202);

  const tools = (await call("tools/list")).body.result.tools.map((x: { name: string }) => x.name);
  assert.deepEqual(tools, ["search_tickets", "list_tickets", "get_ticket", "get_customer", "reply_to_ticket", "update_ticket"]);

  const found = JSON.parse((await tool("search_tickets", { query: "crushed" })).content[0].text);
  assert.deepEqual(found.tickets.map((x: { number: number }) => x.number), [t.number], "only this team's tickets");

  const read = JSON.parse((await tool("get_ticket", { number: t.number })).content[0].text);
  assert.equal(read.ticket.messages[0].body, "The box arrived crushed");
  const missing = await tool("get_ticket", { number: theirs.number + 1000 });
  assert.equal(missing.isError, true);

  const changed = JSON.parse((await tool("update_ticket", { number: t.number, priority: "urgent", add_tags: ["damaged"] })).content[0].text);
  assert.equal(changed.ticket.priority, "urgent");
  assert.deepEqual(changed.ticket.tags, ["damaged"]);

  const noted = JSON.parse((await tool("reply_to_ticket", { number: t.number, body: "Asked the courier for photos.", internal: true })).content[0].text);
  assert.equal(noted.ticket.messages.at(-1).internal, true);
  assert.equal(noted.ticket.status, "open", "a note leaves the status");

  assert.equal((await call("resources/list")).body.error.code, -32601);
  assert.equal((await call("tools/call", { name: "drop_tables", arguments: {} })).body.error.code, -32602);

  // A team whose trial ended can read but not change.
  const { handleRpc } = await import("./mcp");
  const lockedCaller = { orgId: ORG, keyId: "k", createdBy: "u_ada", locked: true };
  const refused = (await handleRpc(lockedCaller, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "update_ticket", arguments: { number: t.number, status: "closed" } } })) as { result: { isError?: boolean } };
  assert.equal(refused.result.isError, true);
  const allowed = (await handleRpc(lockedCaller, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_ticket", arguments: { number: t.number } } })) as { result: { isError?: boolean } };
  assert.equal(allowed.result.isError, undefined);
});
