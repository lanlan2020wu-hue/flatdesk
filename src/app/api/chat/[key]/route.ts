import { after } from "next/server";
import { answerNewTicket } from "@/lib/ai";
import { triageTicket } from "@/lib/triage";
import { alertNewTicket } from "@/lib/alerts";
import { isBot, orgByWidgetKey, readChatRequest, startConversation, validStart } from "@/lib/chat";
import { hit, ipKey, LIMITS, tooMany } from "@/lib/rate-limit";
import { shareTicketQuietly } from "@/lib/routing";

export const maxDuration = 300;

// Starts a chat conversation from the website widget, with any files attached.
export async function POST(request: Request, ctx: RouteContext<"/api/chat/[key]">) {
  const { key } = await ctx.params;
  const org = await orgByWidgetKey(key);
  if (!org) return Response.json({ error: "Chat isn't set up for this site." }, { status: 404 });
  const body = await readChatRequest(request);
  if ("error" in body) return Response.json({ error: body.error }, { status: 400 });
  if (isBot(body.fields)) return Response.json({ error: "Your message couldn't be sent." }, { status: 400 });
  const v = validStart(body.fields);
  if ("error" in v) return Response.json({ error: v.error }, { status: 400 });

  const ip = ipKey(request);
  // The visitor's own limits first. Only chats that pass them count toward the
  // team's hourly limit, so one sender being refused can't use it up for everyone.
  const own = await hit([...LIMITS.chatStart(ip), ...LIMITS.chatFiles(ip, body.files.length)]);
  if (!own.ok) return tooMany(own.retryAfter);
  const team = await hit([...LIMITS.chatStartTeam(org.id), ...LIMITS.chatTarget(org.id, v.email)]);
  if (!team.ok) return tooMany(team.retryAfter, "Too many new chats right now");

  const { ticket, token } = await startConversation(org.id, v, body.files, org.chatSecret);
  after(async () => {
    await Promise.all([triageTicket(org.id, ticket.id), answerNewTicket(org.id, ticket.id)]);
    await shareTicketQuietly(org.id, ticket.id);
    await alertNewTicket(org.id, ticket.id);
  });
  return Response.json({ number: ticket.number, token });
}
