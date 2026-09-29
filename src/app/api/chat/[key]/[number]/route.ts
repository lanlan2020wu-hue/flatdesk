import { after, connection } from "next/server";
import { answerFollowUp } from "@/lib/ai";
import { MAX_MESSAGE, orgByWidgetKey, readChatRequest, ticketForVisitor, visitorReply, visitorThread } from "@/lib/chat";
import { hit, ipKey, LIMITS, tooMany } from "@/lib/rate-limit";

async function load(ctx: RouteContext<"/api/chat/[key]/[number]">, token: string) {
  const { key, number } = await ctx.params;
  const org = await orgByWidgetKey(key);
  if (!org) return null;
  const ticket = await ticketForVisitor(org.id, Number(number), token);
  return ticket ? { org, ticket, link: { orgId: org.id, key, number: ticket.number, token } } : null;
}

// The visitor's view of their conversation.
export async function GET(request: Request, ctx: RouteContext<"/api/chat/[key]/[number]">) {
  await connection();
  const token = request.headers.get("x-visitor-token") ?? "";
  const found = await load(ctx, token);
  if (!found) return Response.json({ error: "Conversation not found." }, { status: 404 });
  return Response.json(
    { status: found.ticket.status, messages: await visitorThread(found.ticket.id, found.link) },
    { headers: { "cache-control": "no-store" } },
  );
}

// The visitor writes again, with or without files.
export async function POST(request: Request, ctx: RouteContext<"/api/chat/[key]/[number]">) {
  const body = await readChatRequest(request);
  if ("error" in body) return Response.json({ error: body.error }, { status: 400 });
  const found = await load(ctx, typeof body.fields.token === "string" ? body.fields.token : "");
  if (!found) return Response.json({ error: "Conversation not found." }, { status: 404 });
  const message = typeof body.fields.message === "string" ? body.fields.message.trim().slice(0, MAX_MESSAGE) : "";
  if (!message && !body.files.length) return Response.json({ error: "Write a message first." }, { status: 400 });

  const ip = ipKey(request);
  const verdict = await hit([...LIMITS.chatReply(ip, found.ticket.id), ...LIMITS.chatFiles(ip, body.files.length)]);
  if (!verdict.ok) return tooMany(verdict.retryAfter);

  await visitorReply(found.org.id, found.ticket, message, body.files);
  // On a ticket the AI answered, it answers the follow-up or hands the ticket to the team.
  const { org, ticket } = found;
  if (ticket.resolvedByAi) after(() => answerFollowUp(org.id, ticket.id));
  return Response.json({ messages: await visitorThread(found.ticket.id, found.link) });
}
