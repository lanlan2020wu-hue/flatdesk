import { json, withKey } from "@/lib/api";
import { handleRpc } from "@/lib/mcp";

// Flatdesk's MCP server (lib/mcp.ts). Connect with the URL
// https://flatdesk.app/api/mcp and the header Authorization: Bearer fd_...
export const maxDuration = 60;

export async function POST(request: Request) {
  return withKey(request, async (caller) => {
    const text = await request.text();
    if (text.length > 200_000) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "The request is too large." } }, 413);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "The request isn't valid JSON." } }, 400);
    }
    const out = await handleRpc(caller, raw);
    // Notifications get "accepted" and no body.
    return out ? json(out) : new Response(null, { status: 202 });
  });
}

// No server-to-client stream: everything comes back in the POST's response.
export async function GET() {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}
