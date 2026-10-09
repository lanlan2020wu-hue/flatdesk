import Link from "next/link";
import Logo from "@/components/Logo";
import MotionObserver from "@/components/MotionObserver";
import { CHECKED_ON } from "@/lib/pricing";
import { SITE } from "@/lib/site";

// Same order as the site: the flat rate first, then AI macros, then the rest.
const NAV = [
  { href: "/pricing", label: "Pricing" },
  { href: "/features/ai-macros", label: "AI macros" },
  { href: "/features", label: "Features" },
  { href: "/compare", label: "Compare" },
  { href: "/calculator", label: "Calculator" },
];

// The footer sorts every marketing page into the columns a buyer scans for.
const FOOTER = [
  {
    title: "Product",
    links: [
      { href: "/pricing", label: "Pricing" },
      { href: "/features", label: "Features" },
      { href: "/features/ai-macros", label: "AI macros" },
      { href: "/integrations", label: "Integrations" },
      { href: "/developers", label: "Developers" },
      { href: "/enterprise", label: "Done-for-you AI setup" },
    ],
  },
  {
    title: "Compare",
    links: [
      { href: "/compare", label: "Help desk comparisons" },
      { href: "/calculator", label: "Bill calculator" },
      { href: "/help-desk-for-small-teams", label: "For small teams" },
      { href: "/ai-billing-changes-2026", label: "2026 AI billing changes" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: "/free-tools", label: "Free tools" },
      { href: "/faq", label: "FAQ" },
      { href: "/about", label: "About" },
      { href: "/security", label: "Security" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/terms", label: "Terms" },
      { href: "/privacy", label: "Privacy" },
      { href: "/dpa", label: "DPA" },
    ],
  },
];

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
      <main id="main" className="site relative flex-1 overflow-x-clip">{children}</main>
      <script dangerouslySetInnerHTML={{ __html: PLAY_EARLY }} />
      <MotionObserver />
      <footer className="site mt-24 bg-field text-field-ink">
        <div className="mx-auto grid max-w-6xl gap-10 border-t border-field-line px-4 py-14 sm:px-6 lg:grid-cols-[1.3fr_repeat(4,1fr)] lg:gap-8">
          <div className="grid content-start gap-3">
            <Logo onField />
            <p className="max-w-[30ch] text-sm text-field-muted">The help desk for small support teams, at one flat price per agent.</p>
            <a href={`mailto:${SITE.contactEmail}`} className="w-max text-sm text-field-muted transition-colors hover:text-field-ink">Contact us</a>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 lg:contents">
            {FOOTER.map((col) => (
              <div key={col.title} className="grid content-start gap-2.5 text-sm">
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-field-ink">{col.title}</p>
                {col.links.map((n) => (
                  <Link key={n.href} href={n.href} className="w-max text-field-muted transition-colors hover:text-field-ink">
                    {n.label}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-field-line">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-5 text-xs text-field-muted sm:px-6">
            <p>© {new Date().getFullYear()} {SITE.legalName}. All rights reserved.</p>
            <p>Competitor prices last checked {CHECKED_ON}.</p>
          </div>
        </div>
      </footer>
    </>
  );
}
