import { createHash, timingSafeEqual } from "node:crypto";

// Vercel Cron (vercel.json) sends CRON_SECRET as a bearer token; anything else
// is refused. Compared in constant time; hashing first gives both sides the same length.
export function cronAuthorized(request: Request): boolean {
  const header = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}
