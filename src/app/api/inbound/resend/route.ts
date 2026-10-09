import { after } from "next/server";
import { answerNewTicket } from "@/lib/ai";
import { triageTicket } from "@/lib/triage";
import { alertNewTicket } from "@/lib/alerts";
import { emailConfig, htmlToText, resend } from "@/lib/email";
import { downloadInbound } from "@/lib/attachments";
import { handleInboundEmailAll } from "@/lib/inbound";
import { sendAfterHoursReply } from "@/lib/after-hours";
import { shareTicketQuietly } from "@/lib/routing";

// Resend calls this for every email sent to INBOUND_DOMAIN (event
// "email.received"). The webhook carries metadata only, so the body is
// fetched from the receiving API.
// The AI answer runs after the response, within this limit.
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!emailConfig.webhookSecret || !emailConfig.apiKey) {
    return Response.json({ error: "Inbound email is not configured." }, { status: 503 });
  }

  const payload = await request.text();
  let event: { type: string; data: { email_id?: string } };
  try {
    event = resend().webhooks.verify({
      payload,
      headers: {
        id: request.headers.get("svix-id") ?? "",
        timestamp: request.headers.get("svix-timestamp") ?? "",
        signature: request.headers.get("svix-signature") ?? "",
      },
      webhookSecret: emailConfig.webhookSecret,
    }) as typeof event;
  } catch {
    return Response.json({ error: "Invalid signature." }, { status: 401 });
  }
  if (event.type !== "email.received" || !event.data.email_id) return Response.json({ ignored: true });

  const { data: email, error } = await resend().emails.receiving.get(event.data.email_id);
  if (error || !email) {
    // 5xx makes Resend retry later.
    return Response.json({ error: error?.message ?? "Could not fetch email." }, { status: 502 });
  }

  // Envelope recipients first: they say which team this copy was delivered for.
  const results = await handleInboundEmailAll({
    from: email.from,
    to: [...(email.received_for ?? []), ...email.to, ...(email.cc ?? [])],
    subject: email.subject,
    text: email.text ?? (email.html ? htmlToText(email.html) : ""),
    headers: email.headers,
    messageId: email.message_id,
    copied: [...email.to, ...(email.cc ?? [])],
    attachments: async () => {
      if (!email.attachments?.length) return { files: [], skipped: [] };
      const { data, error: listError } = await resend().emails.receiving.attachments.list({ emailId: email.id });
      if (listError || !data) {
        console.error("listing attachments failed", listError);
        return { files: [], skipped: email.attachments.map((a) => a.filename ?? "attachment") };
      }
      return downloadInbound(data.data);
    },
  });
  const done = results.filter((r) => r.orgId && r.ticketId);
  if (done.length) {
    after(async () => {
      for (const r of done) {
        // Mail whose From failed the sender's own DMARC check is never answered by
        // the AI: someone may be pretending to be a customer to get their details.
        // Triage runs beside the answer, and before the ticket is shared in turn, so its group counts.
        if (!r.unverified) await Promise.all([r.action === "created" ? triageTicket(r.orgId!, r.ticketId!) : null, answerNewTicket(r.orgId!, r.ticketId!)]);
        if (r.action === "created") {
          if (!r.unverified) await sendAfterHoursReply(r.orgId!, r.ticketId!);
          await shareTicketQuietly(r.orgId!, r.ticketId!);
          await alertNewTicket(r.orgId!, r.ticketId!);
        }
      }
    });
    return Response.json({ tickets: done.map((r) => ({ ticket: r.ticket, action: r.action })) });
  }
  return Response.json(results[0] ?? { ignored: true });
}
