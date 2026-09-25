import { db, schema } from "@/db";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254) {
    return Response.json({ error: "Enter a valid work email." }, { status: 400 });
  }
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "The waitlist isn't open yet. Please try again soon." }, { status: 503 });
  }

  const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : null);
  await db
    .insert(schema.waitlist)
    .values({
      email,
      currentTool: str(body.tool),
      agents: Number.isInteger(body.agents) ? body.agents : null,
      source: str(body.source),
      referrer: str(body.referrer, 500),
    })
    .onConflictDoNothing();

  return Response.json({ ok: true });
}
