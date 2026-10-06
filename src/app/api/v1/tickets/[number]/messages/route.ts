import { handBackToTeam } from "@/lib/ai";
import { agentByEmail, bool, email, findTicket, json, messagesJson, readBody, status, text, ticketJson, withKey, ApiError } from "@/lib/api";
import { deliverReply } from "@/lib/email";
import { addReply } from "@/lib/tickets";
import { db, schema } from "@/db";
import { and, eq, isNull } from "drizzle-orm";

// POST /api/v1/tickets/:number/messages : a reply to the customer (emailed to
// them) or, with internal: true, a note only the team sees. It's signed by
// author_email, or by whoever made the key. A reply sets the ticket to
// pending unless status says otherwise.
export async function POST(request: Request, ctx: RouteContext<"/api/v1/tickets/[number]/messages">) {
  const { number } = await ctx.params;
  return withKey(
    request,
    async (caller) => {
      const row = await findTicket(caller.orgId, number);
      const body = await readBody(request);
      const message = text(body, "body", { required: true, max: 50_000 })!;
      const internal = bool(body, "internal", false);
      const authorEmail = email(body, "author_email");
      const author = authorEmail ? await agentByEmail(caller.orgId, authorEmail) : await keyOwner(caller.orgId, caller.createdBy);
      const { messageId } = await addReply({
        orgId: caller.orgId,
        ticketId: row.ticket.id,
        userId: author.userId,
        body: message,
        internal,
        status: status(body.status) ?? (internal ? null : "pending"),
      });
      if (messageId && !internal) {
        await deliverReply(caller.orgId, messageId);
        // Like a reply typed in the app: the AI didn't finish this one alone.
        if (row.ticket.resolvedByAi) await handBackToTeam(caller.orgId, row.ticket.id, "A person on the team replied.", false);
      }
      const updated = await findTicket(caller.orgId, number);
      return json({ ticket: { ...ticketJson(updated), messages: await messagesJson(caller.orgId, updated.ticket.id) } }, 201);
    },
    { write: true },
  );
}

async function keyOwner(orgId: string, userId: string) {
  const agent = await db.query.agents.findFirst({
    where: and(eq(schema.agents.orgId, orgId), eq(schema.agents.userId, userId), isNull(schema.agents.removedAt)),
  });
  if (!agent || agent.viewer) throw new ApiError(400, "Whoever made this key can't reply anymore. Send author_email with the address of someone on the team.");
  return agent;
}
