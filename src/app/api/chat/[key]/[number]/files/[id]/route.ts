import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { downloadResponse, loadAttachment } from "@/lib/attachments";
import { orgByWidgetKey, ticketForVisitor } from "@/lib/chat";

// A chat visitor downloads a file from their own conversation. Links are
// opened in a new tab, which can't send headers, so the token is in the query.
export async function GET(request: Request, ctx: RouteContext<"/api/chat/[key]/[number]/files/[id]">) {
  const { key, number, id } = await ctx.params;
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const org = await orgByWidgetKey(key);
  const ticket = org && (await ticketForVisitor(org.id, number, token));
  const row = ticket ? await loadAttachment(org.id, id, ticket.id) : null;
  if (!row) return new Response("Not found", { status: 404 });
  // Files on internal notes are never shown to visitors.
  const message = await db.query.messages.findFirst({ where: eq(schema.messages.id, row.messageId), columns: { internal: true, authorType: true, emailMessageId: true } });
  // Same rule as the conversation itself (visitorThread): no internal notes, and no customer email.
  if (!message || message.internal || message.authorType === "system" || (message.authorType === "customer" && message.emailMessageId)) return new Response("Not found", { status: 404 });
  return downloadResponse(row, true);
}
