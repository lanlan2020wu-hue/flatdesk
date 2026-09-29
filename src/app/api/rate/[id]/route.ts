import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { handBackToTeam } from "@/lib/ai";
import { isRating, recordRating, saveComment } from "@/lib/csat";
import { hit, ipKey, LIMITS, tooMany } from "@/lib/rate-limit";

// A customer rates one reply from the links under a reply email, then may add
// a comment. Called by the rating page's script, never by the link itself.
export async function POST(request: Request, ctx: RouteContext<"/api/rate/[id]">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const verdict = await hit(LIMITS.rate(ipKey(request)));
  if (!verdict.ok) return tooMany(verdict.retryAfter, "Too many ratings from your connection");

  if (typeof body?.comment === "string") {
    await saveComment(id, body.comment);
    return Response.json({ ok: true });
  }
  if (!isRating(body?.rating)) return Response.json({ error: "Pick a rating." }, { status: 400 });
  const result = await recordRating(id, body.rating, { change: body.change === true });
  if (!result.ok) return Response.json({ error: result.error }, { status: 409 });

  // "Not good" on an AI answer: the AI didn't help, so the ticket goes to the team and stops counting.
  if (result.handBack) {
    const [message] = await db.select({ orgId: schema.messages.orgId, ticketId: schema.messages.ticketId }).from(schema.messages).where(eq(schema.messages.id, id));
    await db
      .update(schema.tickets)
      .set({ status: "open", closedAt: null, updatedAt: new Date() })
      .where(and(eq(schema.tickets.id, message.ticketId), eq(schema.tickets.resolvedByAi, true)));
    await handBackToTeam(message.orgId, message.ticketId, "The customer rated the AI's answer Not good, so this ticket is now with the team.");
  }
  return Response.json({ ok: true, rating: result.rating });
}
