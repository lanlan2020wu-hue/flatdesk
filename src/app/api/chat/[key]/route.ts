import { after } from "next/server";
import { answerNewTicket } from "@/lib/ai";
import { orgByWidgetKey, startConversation, validStart } from "@/lib/chat";

export const maxDuration = 300;

// Starts a chat conversation from the website widget.
export async function POST(request: Request, ctx: RouteContext<"/api/chat/[key]">) {
  const { key } = await ctx.params;
  const org = await orgByWidgetKey(key);
  if (!org) return Response.json({ error: "Chat isn't set up for this site." }, { status: 404 });
  const v = validStart(await request.json().catch(() => null));
  if ("error" in v) return Response.json({ error: v.error }, { status: 400 });
  const { ticket, token } = await startConversation(org.id, v);
  after(() => answerNewTicket(org.id, ticket.id));
  return Response.json({ number: ticket.number, token });
}
