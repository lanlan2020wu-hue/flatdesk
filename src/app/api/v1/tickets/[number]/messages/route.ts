import { json, postMessage, readBody, withKey } from "@/lib/api";

// POST /api/v1/tickets/:number/messages : a reply to the customer (emailed to
// them) or, with internal: true, a note only the team sees. See postMessage.
export async function POST(request: Request, ctx: RouteContext<"/api/v1/tickets/[number]/messages">) {
  const { number } = await ctx.params;
  return withKey(request, async (caller) => json({ ticket: await postMessage(caller, number, await readBody(request)) }, 201), { write: true });
}
