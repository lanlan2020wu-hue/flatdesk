import { answerNewTicket } from "@/lib/ai";
import { alertNewTicket } from "@/lib/alerts";
import { cronAuthorized } from "@/lib/cron";
import { pollMailboxes } from "@/lib/mailbox";
import { shareTicketQuietly } from "@/lib/routing";

// Every couple of minutes (vercel.json): reads new mail from connected
// mailboxes, then does for each new message what the inbound webhook does.
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const found = await pollMailboxes();
  for (const r of found) {
    try {
      // Mail whose From failed DMARC is never answered by the AI.
      if (!r.unverified) await answerNewTicket(r.orgId, r.ticketId);
      if (r.action === "created") {
        await shareTicketQuietly(r.orgId, r.ticketId);
        await alertNewTicket(r.orgId, r.ticketId);
      }
    } catch (err) {
      console.error("mailbox follow-up failed", r.ticketId, err);
    }
  }
  return Response.json({ messages: found.length });
}
