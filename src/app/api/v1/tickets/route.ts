import { after } from "next/server";
import { answerNewTicket } from "@/lib/ai";
import { triageTicket } from "@/lib/triage";
import { alertNewTicket } from "@/lib/alerts";
import { bool, email, findTicket, json, listTicketsJson, readBody, tagArray, text, ticketJson, withKey, ApiError } from "@/lib/api";
import { INPUT } from "@/lib/app-input";
import { hit, LIMITS } from "@/lib/rate-limit";
import { createTicket } from "@/lib/tickets";
import { shareTicketQuietly } from "@/lib/routing";

export const maxDuration = 300;

// GET /api/v1/tickets: newest change first. Filters: status, updated_since, customer_email, tag, limit.
export async function GET(request: Request) {
  return withKey(request, async (caller) => json({ tickets: await listTicketsJson(caller.orgId, new URL(request.url).searchParams) }));
}

// POST /api/v1/tickets: a new ticket from a customer, as if they had emailed
// (a contact form, an order problem flagged by another tool). Replies go to
// the customer by email. The AI answers it like any new email unless ai_answer is false.
export async function POST(request: Request) {
  return withKey(
    request,
    async (caller) => {
      const body = await readBody(request);
      const customerEmail = email(body, "customer_email", true)!;
      const customerName = text(body, "customer_name", { max: INPUT.name });
      const subject = text(body, "subject", { required: true, max: INPUT.subject })!;
      const message = text(body, "body", { required: true, max: 50_000 })!;
      const tags = tagArray(body, "tags");
      const aiAnswer = bool(body, "ai_answer", true);
      const limit = await hit(LIMITS.apiNewTicket(caller.orgId));
      if (!limit.ok) throw new ApiError(429, "Too many new tickets from the API this hour. Try again later.");

      const ticket = await createTicket({
        orgId: caller.orgId,
        channel: "email",
        customerEmail,
        customerName,
        subject,
        body: message,
        authorType: "customer",
        tags,
      });
      after(async () => {
        await Promise.all([triageTicket(caller.orgId, ticket.id), aiAnswer ? answerNewTicket(caller.orgId, ticket.id) : null]);
        await shareTicketQuietly(caller.orgId, ticket.id);
        await alertNewTicket(caller.orgId, ticket.id);
      });
      return json({ ticket: ticketJson(await findTicket(caller.orgId, String(ticket.number))) }, 201);
    },
    { write: true },
  );
}
