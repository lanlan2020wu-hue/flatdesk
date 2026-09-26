import { connection } from "next/server";
import { MAX_MESSAGE, orgByWidgetKey, ticketForVisitor, visitorReply, visitorThread } from "@/lib/chat";

async function load(ctx: RouteContext<"/api/chat/[key]/[number]">, token: string) {
  const { key, number } = await ctx.params;
  const org = await orgByWidgetKey(key);
  if (!org) return null;
  const ticket = await ticketForVisitor(org.id, Number(number), token);
  return ticket ? { org, ticket } : null;
}

// The visitor's view of their conversation.
export async function GET(request: Request, ctx: RouteContext<"/api/chat/[key]/[number]">) {
  await connection();
  const token = request.headers.get("x-visitor-token") ?? "";
  const found = await load(ctx, token);
  if (!found) return Response.json({ error: "Conversation not found." }, { status: 404 });
  return Response.json(
    { status: found.ticket.status, messages: await visitorThread(found.ticket.id) },
    { headers: { "cache-control": "no-store" } },
  );
}

// The visitor writes again.
export async function POST(request: Request, ctx: RouteContext<"/api/chat/[key]/[number]">) {
  const body = (await request.json().catch(() => null)) as { token?: unknown; message?: unknown } | null;
  const found = await load(ctx, typeof body?.token === "string" ? body.token : "");
  if (!found) return Response.json({ error: "Conversation not found." }, { status: 404 });
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE) : "";
  if (!message) return Response.json({ error: "Write a message first." }, { status: 400 });
  await visitorReply(found.org.id, found.ticket, message);
  return Response.json({ messages: await visitorThread(found.ticket.id) });
}
