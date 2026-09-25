import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { CHECKED_ON } from "@/lib/pricing";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["600"],
});

export const metadata: Metadata = {
  title: {
    default: "Flatdesk: the help desk with one flat price",
    template: "%s · Flatdesk",
  },
  description:
    "$49 per agent per month. AI resolutions included and capped, so your support bill is the same every month.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans text-[15px] leading-relaxed">
        <header className="border-b border-line">
          <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4">
            <Link href="/" className="font-display text-xl">
              Flatdesk
            </Link>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
              <Link href="/calculator" className="hover:text-ink">
                Bill calculator
              </Link>
              <Link href="/pricing" className="hover:text-ink">
                Pricing
              </Link>
              <Link href="/ai-billing-changes-2026" className="hover:text-ink">
                2026 AI billing changes
              </Link>
            </div>
            <Link
              href="/#waitlist"
              className="ml-auto rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
            >
              Join the waitlist
            </Link>
          </nav>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-5xl flex-wrap justify-between gap-2 px-4 py-6 text-sm text-muted">
            <span>Flatdesk. One flat price for support teams.</span>
            <span>Competitor prices last checked {CHECKED_ON}.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
