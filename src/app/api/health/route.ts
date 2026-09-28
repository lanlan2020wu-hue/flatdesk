import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";
import { aiConfigured } from "@/lib/ai";
import { clerkEnabled } from "@/lib/auth-config";
import { emailConfig } from "@/lib/email";
import { SITE } from "@/lib/site";

// "live" or "test" from the key's prefix (sk_live_ / rk_live_ vs sk_test_), so a
// deploy can be checked for the right Stripe mode without exposing the key.
function stripeMode() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return /^(sk|rk)_live_/.test(key) ? "live" : "test";
}

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
      billing: stripeMode(),
      signInMode: clerkEnabled ? (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_live_") ? "live" : "development") : null,
      site: SITE.url,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
