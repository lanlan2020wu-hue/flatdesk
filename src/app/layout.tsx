import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Red_Hat_Mono, Schibsted_Grotesk } from "next/font/google";
import { PLAN, usd } from "@/lib/pricing";
import { SITE } from "@/lib/site";
import "./globals.css";

// One grotesk for everything, from body text up to the headlines: Schibsted
// Grotesk was drawn for a newspaper, and reads like plain facts about a bill.
const sans = Schibsted_Grotesk({
  variable: "--font-sans-face",
  subsets: ["latin"],
});

// Every figure (prices, counts, totals) is set in mono, like a statement.
const mono = Red_Hat_Mono({
  variable: "--font-mono-face",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  openGraph: { siteName: "Flatdesk", type: "website" },
  title: {
    default: "Flatdesk: flat-price help desk with AI answers included",
    template: "%s · Flatdesk",
  },
  description:
    `${usd(PLAN.seatPrice)} per agent per month, or ${usd(PLAN.annualSeatPrice)} billed yearly. AI answers included and capped, so your support bill is the same every month.`,
  // Google Search Console and Bing Webmaster Tools ownership checks: paste the
  // token from their "HTML tag" option into these environment variables.
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
    other: process.env.BING_SITE_VERIFICATION ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION } : undefined,
  },
};

// Clerk is provided only by the routes that sign people in (AuthProvider), so
// marketing pages don't load Clerk's scripts.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans text-[15px] leading-relaxed">
        {children}
        {/* Page views for the trial funnel; the later steps are server events (lib/funnel.ts). */}
        <Analytics />
      </body>
    </html>
  );
}
