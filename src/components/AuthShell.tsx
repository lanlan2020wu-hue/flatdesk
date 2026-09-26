import Link from "next/link";
import Logo from "@/components/Logo";
import { FeatureIcon } from "@/components/ProductShots";
import { FEATURE_GROUPS } from "@/lib/features";
import { PLAN, usd } from "@/lib/pricing";

// Sign-in and sign-up: the form on one side, everything the plan includes on the other.
export default function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen flex-1 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
      <section className="relative isolate order-2 overflow-hidden border-t border-line bg-surface-2/60 px-6 py-12 sm:px-10 lg:order-1 lg:border-t-0 lg:border-r lg:px-14 lg:py-14">
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden opacity-40" aria-hidden="true">
          <div className="ribbon" />
        </div>
        <div className="grid max-w-2xl gap-10">
          <div className="hidden lg:block">
            <Logo />
          </div>
          <div className="grid gap-3">
            <p className="eyebrow">Every seat includes</p>
            <h2 className="font-display text-3xl leading-tight sm:text-4xl">
              The whole help desk for {usd(PLAN.seatPrice)} an agent. <span className="text-muted">AI included, and capped.</span>
            </h2>
          </div>
          <div className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
            {FEATURE_GROUPS.map((g) => (
              <div key={g.id} className="grid content-start gap-2.5">
                <h3 className="eyebrow">{g.title}</h3>
                <ul className="grid gap-2">
                  {g.features.map((f) => (
                    <li key={f.id} className="flex items-center gap-2.5 text-sm" title={f.body}>
                      <FeatureIcon d={f.icon} className="size-7 bg-surface p-[5px] shadow-sm ring-1 ring-line" />
                      <span>{f.title}</span>
                      {f.id === "receipts" && <span className="rounded-full bg-accent px-1.5 py-px text-[10px] font-medium text-accent-ink">New</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted">
            <Link href="/#features" className="link">Take the product tour</Link> or{" "}
            <Link href="/calculator" className="link">compare your current bill</Link>.
          </p>
        </div>
      </section>
      <section className="order-1 grid content-center justify-items-center gap-6 px-4 py-12 lg:order-2">
        <div className="lg:hidden">
          <Logo />
        </div>
        <h1 className="sr-only">{title}</h1>
        {children}
      </section>
    </div>
  );
}
