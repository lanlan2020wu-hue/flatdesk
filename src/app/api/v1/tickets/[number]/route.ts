import { findTicket, json, messagesJson, patchTicket, readBody, ticketJson, withKey } from "@/lib/api";

// GET /api/v1/tickets/:number : the ticket and its whole conversation, internal notes included.
export async function GET(request: Request, ctx: RouteContext<"/api/v1/tickets/[number]">) {
  const { number } = await ctx.params;
  return withKey(request, async (caller) => {
    const row = await findTicket(caller.orgId, number);
    return json({ ticket: { ...ticketJson(row), messages: await messagesJson(caller.orgId, row.ticket.id) } });
  });
}

// PATCH /api/v1/tickets/:number : status, priority, assignee_email (null to unassign), tags (replaces) or add_tags.
export async function PATCH(request: Request, ctx: RouteContext<"/api/v1/tickets/[number]">) {
  const { number } = await ctx.params;
  return withKey(request, async (caller) => json({ ticket: await patchTicket(caller, number, await readBody(request)) }), { write: true });
}
