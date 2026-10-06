import { ApiError, customerJson, findTicket, listTicketsJson, messagesJson, patchTicket, postMessage, ticketJson } from "@/lib/api";
import type { ApiCaller } from "@/lib/api-keys";
import { LOCKED_MESSAGE } from "@/lib/auth";
import { searchTickets } from "@/lib/search";
import { SITE } from "@/lib/site";

// Flatdesk as an MCP server, so Claude, Cursor and other AI tools can read and
// work tickets with a team's API key. Plain JSON-RPC over HTTP POST (MCP's
// "streamable HTTP" transport without sessions or streaming): every request
// gets one JSON response. Tools call the same code as the REST API.

export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };
type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  write?: boolean;
  run: (caller: ApiCaller, args: Record<string, unknown>) => Promise<unknown>;
};

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const NUMBER = { type: "integer", minimum: 1, description: "The ticket number, like 1042." };
const str = (v: unknown) => (typeof v === "number" ? String(v) : typeof v === "string" ? v : "");

export const TOOLS: Tool[] = [
  {
    name: "search_tickets",
    title: "Search tickets",
    description: "Find tickets by words in any message or the subject, a customer's name or email, a tag, or a ticket number like #1042. Returns up to 100, newest first, in any status.",
    inputSchema: obj({ query: { type: "string", description: "What to look for." } }, ["query"]),
    annotations: { readOnlyHint: true },
    run: async (caller, a) => {
      const rows = await searchTickets(caller.orgId, str(a.query));
      return { tickets: rows.map((t) => ({ number: t.number, subject: t.subject, status: t.status, customer: t.customerName ?? t.customerEmail, updated_at: t.updatedAt.toISOString(), url: `${SITE.url}/app/tickets/${t.number}` })) };
    },
  },
  {
    name: "list_tickets",
    title: "List tickets",
    description: "Tickets by most recent change. Filter by status (open, pending, closed), a tag, or a customer's email.",
    inputSchema: obj({
      status: { type: "string", enum: ["open", "pending", "closed"] },
      tag: { type: "string" },
      customer_email: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 100, description: "Default 20." },
    }),
    annotations: { readOnlyHint: true },
    run: async (caller, a) => {
      const params = new URLSearchParams();
      for (const k of ["status", "tag", "customer_email"]) if (str(a[k])) params.set(k, str(a[k]));
      params.set("limit", str(a.limit) || "20");
      return { tickets: await listTicketsJson(caller.orgId, params) };
    },
  },
  {
    name: "get_ticket",
    title: "Read a ticket",
    description: "A ticket with its whole conversation: the customer's messages, replies, AI answers and internal notes (marked internal).",
    inputSchema: obj({ number: NUMBER }, ["number"]),
    annotations: { readOnlyHint: true },
    run: async (caller, a) => {
      const row = await findTicket(caller.orgId, str(a.number));
      return { ticket: { ...ticketJson(row), messages: await messagesJson(caller.orgId, row.ticket.id) } };
    },
  },
  {
    name: "get_customer",
    title: "Look up a customer",
    description: "A customer by email, with their details and their last 50 tickets.",
    inputSchema: obj({ email: { type: "string" } }, ["email"]),
    annotations: { readOnlyHint: true },
    run: async (caller, a) => ({ customer: await customerJson(caller.orgId, str(a.email).trim().toLowerCase()) }),
  },
  {
    name: "reply_to_ticket",
    title: "Reply or add a note",
    description:
      "Send a reply to the customer (it's emailed to them right away) or, with internal: true, add a note only the team sees. Signed by author_email, or by whoever made the API key. A reply sets the ticket to pending unless status says otherwise. Check with the person you're helping before sending a reply to a customer.",
    inputSchema: obj(
      {
        number: NUMBER,
        body: { type: "string", description: "Plain text." },
        internal: { type: "boolean", description: "true for a note only the team sees. Default false." },
        status: { type: "string", enum: ["open", "pending", "closed"] },
        author_email: { type: "string", description: "Someone on the team to sign it as." },
      },
      ["number", "body"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    write: true,
    run: async (caller, a) => ({ ticket: await postMessage(caller, str(a.number), a) }),
  },
  {
    name: "update_ticket",
    title: "Change a ticket",
    description: "Set a ticket's status, priority or assignee (by email, null to unassign), replace its tags, or add tags.",
    inputSchema: obj(
      {
        number: NUMBER,
        status: { type: "string", enum: ["open", "pending", "closed"] },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        assignee_email: { type: ["string", "null"] },
        tags: { type: "array", items: { type: "string" } },
        add_tags: { type: "array", items: { type: "string" } },
      },
      ["number"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    write: true,
    run: async (caller, a) => {
      const { number, ...rest } = a;
      return { ticket: await patchTicket(caller, str(number), rest) };
    },
  },
];

const result = (id: Rpc["id"], value: unknown) => ({ jsonrpc: "2.0" as const, id: id ?? null, result: value });
const failure = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0" as const, id: id ?? null, error: { code, message } });
const toolText = (value: unknown, isError = false) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) });

// One JSON-RPC message in, one out (null for a notification, which gets no answer).
export async function handleRpc(caller: ApiCaller, raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || (raw as Rpc).jsonrpc !== "2.0" || typeof (raw as Rpc).method !== "string") {
    return failure(null, -32600, "Send one JSON-RPC 2.0 request.");
  }
  const msg = raw as Rpc;
  const isNotification = msg.id === undefined;
  if (isNotification) return null;
  const params = msg.params && typeof msg.params === "object" ? msg.params : {};

  switch (msg.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return result(msg.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "flatdesk", title: "Flatdesk", version: "1.0.0" },
        instructions:
          "Flatdesk is this team's help desk. Use search_tickets or list_tickets to find tickets, get_ticket to read one, and update_ticket or reply_to_ticket to work it. Replies are emailed to the customer immediately, so confirm with the user before sending one.",
      });
    }
    case "ping":
      return result(msg.id, {});
    case "tools/list":
      return result(msg.id, { tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return failure(msg.id, -32602, `There's no tool called ${String(params.name)}.`);
      const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? (params.arguments as Record<string, unknown>) : {};
      if (tool.write && caller.locked) return result(msg.id, toolText(LOCKED_MESSAGE, true));
      try {
        return result(msg.id, toolText(await tool.run(caller, args)));
      } catch (err) {
        if (err instanceof ApiError) return result(msg.id, toolText(err.message, true));
        console.error("mcp tool failed", tool.name, err);
        return result(msg.id, toolText("Something went wrong on Flatdesk's side.", true));
      }
    }
    default:
      return failure(msg.id, -32601, `Flatdesk doesn't support ${msg.method}.`);
  }
}
