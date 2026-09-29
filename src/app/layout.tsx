import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { PLAN, usd } from "@/lib/pricing";
import { SITE } from "@/lib/site";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// Mono is only used for small labels, so it isn't preloaded ahead of the text font.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  preload: false,
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["500", "600"],
});

// The italic face sets one phrase on the home page, so it loads on demand.
const frauncesItalic = Fraunces({
  variable: "--font-fraunces-italic",
  subsets: ["latin"],
  weight: ["500", "600"],
  style: "italic",
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  openGraph: { siteName: "Flatdesk", type: "website" },
  title: {
    default: "Flatdesk: the help desk with one flat price",
    template: "%s · Flatdesk",
  },
  description:
    `${usd(PLAN.seatPrice)} per agent per month, or ${usd(PLAN.annualSeatPrice)} billed yearly. AI resolutions included and capped, so your support bill is the same every month.`,
};

// Clerk is provided only by the routes that sign people in (AuthProvider), so
// marketing pages don't load Clerk's scripts.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable} ${fraunces.variable} ${frauncesItalic.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans text-[15px] leading-relaxed">
        {children}
      </body>
    </html>
  );
}
