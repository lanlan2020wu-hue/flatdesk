import Link from "next/link";
import Logo from "@/components/Logo";
import MotionObserver from "@/components/MotionObserver";
import { CHECKED_ON } from "@/lib/pricing";
import { SITE } from "@/lib/site";

// Same order as the site: the flat rate first, then AI macros, then the rest.
const NAV = [
  { href: "/pricing", label: "Flat rate" },
  { href: "/features/ai-macros", label: "AI macros" },
  { href: "/features", label: "All features" },
  { href: "/compare", label: "Compare" },
  { href: "/calculator", label: "Bill calculator" },
];
const FOOTER = [...NAV, { href: "/help-desk-for-small-teams", label: "For small teams" }, { href: "/enterprise", label: "Done-for-you AI setup" }, { href: "/ai-billing-changes-2026", label: "2026 AI billing changes" }, { href: "/free-tools", label: "Free tools for support teams" }, { href: "/faq", label: "FAQ" }];

// The same observer MotionObserver sets up, but inline, so [data-play] blocks
// (the calculator, the hero receipt) show before React hydrates, or if a
// script chunk never loads. MotionObserver takes over for client navigations.
const PLAY_EARLY = `(function(){var els=document.querySelectorAll("[data-play]:not([data-play='on'])");if(!("IntersectionObserver" in window)){els.forEach(function(e){e.dataset.play="on"});return}var io=new IntersectionObserver(function(es){es.forEach(function(e){if(!e.isIntersecting&&e.boundingClientRect.top>0)return;e.target.dataset.play="on";io.unobserve(e.target)})},{rootMargin:"0px 0px -18% 0px"});els.forEach(function(e){io.observe(e)})})();`;

export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <a href="#main" className="sr-only z-50 rounded-md bg-surface px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:left-4 focus:top-3">
        Skip to content
      </a>
      <header className="site-header sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-md supports-[backdrop-filter]:bg-bg/70">
        <nav className="mx-auto grid max-w-6xl grid-cols-[auto_1fr_auto] items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Logo />
          <div className="nav-scroll col-span-3 row-start-2 -mx-1 flex min-w-0 gap-x-1 overflow-x-auto text-sm md:col-span-1 md:col-start-2 md:row-start-1">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-ink">
                {n.label}
              </Link>
            ))}
          </div>
          <div className="col-start-3 row-start-1 flex items-center gap-2">
            <Link href="/sign-in" className="hidden whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors hover:text-ink sm:inline-flex">
              Sign in
            </Link>
            <Link href="/sign-up" className="btn btn-primary btn-sm">
              Start free trial
            </Link>
          </div>
        </nav>
      </header>
      {/* Decorations (the receipt stamp) may poke past the edge; never let them cause sideways scrolling. */}
      <main id="main" className="relative flex-1 overflow-x-clip">{children}</main>
      <script dangerouslySetInnerHTML={{ __html: PLAY_EARLY }} />
      <MotionObserver />
      <footer className="mt-24 bg-field text-field-ink">
        <div className="mx-auto grid max-w-6xl gap-8 border-t border-field-line px-4 py-12 sm:grid-cols-[1.4fr_1fr] sm:px-6">
          <div className="grid content-start gap-3">
            <Logo onField />
            <p className="max-w-xs text-sm text-field-muted">A help desk for small support teams, at one flat price per agent.</p>
          </div>
          <div className="grid content-start gap-2 text-sm">
            {FOOTER.map((n) => (
              <Link key={n.href} href={n.href} className="w-max text-field-muted transition-colors hover:text-field-ink">
                {n.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="border-t border-field-line">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-4 text-xs text-field-muted sm:px-6">
            <p className="num">Competitor prices last checked {CHECKED_ON}.</p>
            <p className="flex flex-wrap gap-x-4 gap-y-1">
              <Link href="/sign-in" className="transition-colors hover:text-field-ink">Sign in</Link>
              <Link href="/about" className="transition-colors hover:text-field-ink">About</Link>
              <Link href="/security" className="transition-colors hover:text-field-ink">Security</Link>
              <Link href="/terms" className="transition-colors hover:text-field-ink">Terms</Link>
              <Link href="/dpa" className="transition-colors hover:text-field-ink">DPA</Link>
              <Link href="/privacy" className="transition-colors hover:text-field-ink">Privacy</Link>
              <a href={`mailto:${SITE.contactEmail}`} className="transition-colors hover:text-field-ink">{SITE.contactEmail}</a>
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
