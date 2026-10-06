import { agentByEmail, findTicket, json, messagesJson, readBody, status, tagArray, ticketJson, withKey, ApiError } from "@/lib/api";
import { normalizeTags, updateTicket } from "@/lib/tickets";

// GET /api/v1/tickets/:number : the ticket and its whole conversation, internal notes included.
export async function GET(request: Request, ctx: RouteContext<"/api/v1/tickets/[number]">) {
  const { number } = await ctx.params;
  return withKey(request, async (caller) => {
    const row = await findTicket(caller.orgId, number);
    return json({ ticket: { ...ticketJson(row), messages: await messagesJson(caller.orgId, row.ticket.id) } });
  });
}

// PATCH /api/v1/tickets/:number : status, assignee_email (null to unassign), tags (replaces) or add_tags.
export async function PATCH(request: Request, ctx: RouteContext<"/api/v1/tickets/[number]">) {
  const { number } = await ctx.params;
  return withKey(
    request,
    async (caller) => {
      const row = await findTicket(caller.orgId, number);
      const body = await readBody(request);
      const patch: Parameters<typeof updateTicket>[2] = {};
      const s = status(body.status);
      if (s) patch.status = s;
      if ("assignee_email" in body) {
        const v = body.assignee_email;
        if (v !== null && typeof v !== "string") throw new ApiError(400, "assignee_email must be an email address or null.");
        patch.assigneeId = v ? (await agentByEmail(caller.orgId, v.trim())).userId : null;
      }
      const tags = tagArray(body, "tags");
      const addTags = tagArray(body, "add_tags");
      if (tags || addTags) patch.tags = normalizeTags([...(tags ?? row.ticket.tags), ...(addTags ?? [])]);
      if (Object.keys(patch).length === 0) throw new ApiError(400, "Send at least one of status, assignee_email, tags or add_tags.");
      await updateTicket(caller.orgId, row.ticket.id, patch);
      return json({ ticket: ticketJson(await findTicket(caller.orgId, number)) });
    },
    { write: true },
  );
}
