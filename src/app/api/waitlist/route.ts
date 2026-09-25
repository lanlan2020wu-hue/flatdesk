import { neon } from "@neondatabase/serverless";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254) {
    return Response.json({ error: "Enter a valid work email." }, { status: 400 });
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    return Response.json({ error: "The waitlist isn't open yet. Please try again soon." }, { status: 503 });
  }

  const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : null);
  const sql = neon(url);
  await sql`
    create table if not exists waitlist (
      email text primary key,
      current_tool text,
      agents int,
      source text,
      referrer text,
      created_at timestamptz not null default now()
    )`;
  await sql`
    insert into waitlist (email, current_tool, agents, source, referrer)
    values (${email}, ${str(body.tool)}, ${Number.isInteger(body.agents) ? body.agents : null}, ${str(body.source)}, ${str(body.referrer, 500)})
    on conflict (email) do nothing`;

  return Response.json({ ok: true });
}
