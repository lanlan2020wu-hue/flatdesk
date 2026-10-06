import { clerkMiddleware } from "@clerk/nextjs/server";
import { type NextFetchEvent, NextResponse, type NextRequest } from "next/server";
import { encodeSource, SOURCE_COOKIE, SOURCE_MAX_AGE, sourceFromVisit } from "@/lib/attribution";
import { clerkEnabled } from "@/lib/auth-config";
import { isCustomHost } from "@/lib/domains";

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

// A team's help center on its own domain (lib/domains.ts): help.acme.com/x is
// served by /help/help.acme.com/x. Chat, the API and Next's own files pass through.
function customDomain(req: NextRequest) {
  const host = req.headers.get("host");
  if (!isCustomHost(host)) return;
  const path = req.nextUrl.pathname;
  if (path.startsWith("/chat/") || path.startsWith("/api/") || path.startsWith("/_next/") || path === "/favicon.ico") return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = `/help/${host.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "")}${path === "/" ? "" : path}`;
  return NextResponse.rewrite(url);
}

// Auth is checked where data is read: every /app page and action calls
// requireSession(). The middleware only makes the Clerk session available.
const app = clerkEnabled ? clerkMiddleware((_auth, req) => noteSource(req)) : (req: NextRequest) => noteSource(req) ?? NextResponse.next();

export default function proxy(req: NextRequest, event: NextFetchEvent) {
  return customDomain(req) ?? app(req, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
