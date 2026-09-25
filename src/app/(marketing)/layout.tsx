import Link from "next/link";
import Logo from "@/components/Logo";
import { CHECKED_ON } from "@/lib/pricing";

const NAV = [
  { href: "/calculator", label: "Bill calculator" },
  { href: "/pricing", label: "Pricing" },
  { href: "/ai-billing-changes-2026", label: "2026 AI billing changes" },
];

export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-md supports-[backdrop-filter]:bg-bg/70">
        <nav className="mx-auto grid max-w-6xl grid-cols-[auto_1fr_auto] items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Logo />
          <div className="col-span-3 row-start-2 -mx-1 flex gap-x-1 overflow-x-auto text-sm md:col-span-1 md:col-start-2 md:row-start-1">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-ink">
                {n.label}
              </Link>
            ))}
          </div>
          <div className="col-start-3 row-start-1 flex items-center gap-2">
            <Link href="/app" className="rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors hover:text-ink">
              Sign in
            </Link>
            <Link href="/#waitlist" className="btn btn-primary btn-sm">
              Join the waitlist
            </Link>
          </div>
        </nav>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="mt-24 border-t border-line bg-surface-2/60">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-[1.4fr_1fr] sm:px-6">
          <div className="grid content-start gap-3">
            <Logo />
            <p className="max-w-xs text-sm text-muted">One flat price for support teams.</p>
          </div>
          <div className="grid content-start gap-2 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="w-max text-muted transition-colors hover:text-ink">
                {n.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="border-t border-line">
          <p className="num mx-auto max-w-6xl px-4 py-4 text-xs text-muted sm:px-6">Competitor prices last checked {CHECKED_ON}.</p>
        </div>
      </footer>
    </>
  );
}
