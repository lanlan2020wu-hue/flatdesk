import { db, schema } from "@/db";
import { emailConfig, resend } from "@/lib/email";
import { noNul } from "@/lib/ids";
import { hit, ipKey, LIMITS, tooMany } from "@/lib/rate-limit";
import { SITE } from "@/lib/site";

// Requests for the done-for-you AI setup (the /enterprise page). Each one is
// kept, and Flatdesk's contact address gets an email so a person can reply.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? noNul(body.email).trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254) {
    return Response.json({ error: "Enter a valid work email." }, { status: 400 });
  }
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: `Requests aren't open yet. Email ${SITE.contactEmail} instead.` }, { status: 503 });
  }
  // A hidden field only bots fill in: tell them it worked and keep nothing.
  if (typeof body.website === "string" && body.website.trim()) return Response.json({ ok: true });
  const verdict = await hit(LIMITS.aiSetup(ipKey(request)));
  if (!verdict.ok) return tooMany(verdict.retryAfter, "Too many requests from your connection");

  const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? noNul(v).trim().slice(0, max) : null);
  const num = (v: unknown, max: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? (v as number) : null);
  const row = {
    email,
    name: str(body.name),
    company: str(body.company),
    agents: num(body.agents, 100_000),
    monthlyTickets: num(body.monthlyTickets, 100_000_000),
    currentTool: str(body.tool),
    message: str(body.message, 4000),
    source: str(body.source),
    referrer: str(body.referrer, 500),
  };
  await db.insert(schema.aiSetupRequests).values(row);

  // Best effort: the row is the record, the email is the nudge.
  if (emailConfig.apiKey && emailConfig.from) {
    const lines = [
      `From: ${row.name ?? "(no name)"} <${email}>`,
      `Company: ${row.company ?? "-"}`,
      `Agents: ${row.agents ?? "-"}`,
      `Tickets a month: ${row.monthlyTickets ?? "-"}`,
      `Current help desk: ${row.currentTool ?? "-"}`,
      "",
      row.message ?? "(no message)",
    ];
    await resend()
      .emails.send({
        from: emailConfig.from,
        to: SITE.contactEmail,
        replyTo: email,
        subject: `AI setup request: ${(row.company ?? email).replace(/[\r\n]+/g, " ")}`,
        text: lines.join("\n"),
      })
      .catch((err) => console.error("ai-setup: notify failed", err));
  }

  return Response.json({ ok: true });
}
