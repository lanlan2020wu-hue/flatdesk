import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";
import { aiConfigured } from "@/lib/ai";
import { clerkEnabled } from "@/lib/auth-config";
import { emailConfig } from "@/lib/email";

// Which services this deployment is wired to. Booleans only, never values,
// so it is safe to leave public and handy for checking a deploy.
export async function GET() {
  await connection();
  let database: "ok" | "missing" | "error" = process.env.DATABASE_URL ? "ok" : "missing";
  let tables = false;
  if (database === "ok") {
    try {
      const r = await db.execute(sql`select to_regclass('public.waitlist') is not null as ok`);
      tables = Boolean(r.rows[0]?.ok);
    } catch {
      database = "error";
    }
  }
  return Response.json(
    {
      database,
      tables,
      signIn: clerkEnabled,
      email: Boolean(emailConfig.apiKey && emailConfig.from && emailConfig.inboundDomain),
      ai: aiConfigured(),
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
