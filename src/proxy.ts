import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { encodeSource, SOURCE_COOKIE, SOURCE_MAX_AGE, sourceFromVisit } from "@/lib/attribution";
import { clerkEnabled } from "@/lib/auth-config";

// Remembers where a visitor came from on full page loads, so the team they
// create can be credited to a campaign or site (lib/attribution.ts).
function noteSource(req: NextRequest) {
  if (req.method !== "GET" || req.headers.get("sec-fetch-dest") !== "document") return;
  const source = sourceFromVisit(req.nextUrl, req.headers.get("referer"), req.cookies.has(SOURCE_COOKIE));
  if (!source) return;
  const res = NextResponse.next();
  res.cookies.set(SOURCE_COOKIE, encodeSource(source), { maxAge: SOURCE_MAX_AGE, sameSite: "lax", httpOnly: true, secure: req.nextUrl.protocol === "https:", path: "/" });
  return res;
}

// Auth is checked where data is read: every /app page and action calls
// requireSession(). The middleware only makes the Clerk session available.
export default clerkEnabled ? clerkMiddleware((_auth, req) => noteSource(req)) : (req: NextRequest) => noteSource(req) ?? NextResponse.next();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
