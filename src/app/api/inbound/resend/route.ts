import { emailConfig, htmlToText, resend } from "@/lib/email";
import { handleInboundEmail } from "@/lib/inbound";

// Resend calls this for every email sent to INBOUND_DOMAIN (event
// "email.received"). The webhook carries metadata only, so the body is
// fetched from the receiving API.
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

  const result = await handleInboundEmail({
    from: email.from,
    to: [...email.to, ...(email.cc ?? []), ...(email.received_for ?? [])],
    subject: email.subject,
    text: email.text ?? (email.html ? htmlToText(email.html) : ""),
    headers: email.headers,
    messageId: email.message_id,
  });
  return Response.json(result);
}
