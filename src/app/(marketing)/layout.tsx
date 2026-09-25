import Link from "next/link";
import { CHECKED_ON } from "@/lib/pricing";

export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return (
    <>
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
            <Link href="/app" className="ml-auto text-sm text-muted hover:text-ink">
              Sign in
            </Link>
            <Link
              href="/#waitlist"
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
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
    </>
  );
}
