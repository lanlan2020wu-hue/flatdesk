import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { access } from "@/lib/billing";
import { orgByWidgetKey } from "@/lib/chat";
import { articlesForChat } from "@/lib/help";
import { hit, ipKey, LIMITS, tooMany } from "@/lib/rate-limit";

// Help center articles that may answer what a visitor is typing in the chat
// widget, shown under the message box before they start a chat.
export async function GET(request: Request, ctx: RouteContext<"/api/chat/[key]/articles">) {
  const { key } = await ctx.params;
  const found = await orgByWidgetKey(key);
  if (!found) return Response.json({ error: "Chat isn't set up for this site." }, { status: 404 });
  const q = (new URL(request.url).searchParams.get("q") ?? "").replace(/\0/g, "").trim();
  if (q.length < 3) return Response.json({ articles: [] });
  const limit = await hit(LIMITS.chatArticles(ipKey(request)));
  if (!limit.ok) return tooMany(limit.retryAfter, "Too many searches");
  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, found.id) });
  // The help center goes dark with the app when a trial ends without a card.
  if (!org || access(org).state === "locked") return Response.json({ articles: [] });
  return Response.json({ articles: await articlesForChat(org, q) }, { headers: { "cache-control": "no-store" } });
}
