"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

// On phones the sidebar folds into a menu under a slim top bar, so the page
// starts at the top of the screen. From md up it is the usual sidebar.
export default function MobileNav({ bar, children }: { bar: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const params = useSearchParams();
  const where = `${pathname}?${params.toString()}`;
  // Close after navigating.
  useEffect(() => {
    const t = setTimeout(() => setOpen(false), 0);
    return () => clearTimeout(t);
  }, [where]);

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-4 py-3 md:hidden">
        {bar}
        <button
          type="button"
          aria-expanded={open}
          aria-controls="app-nav"
          onClick={() => setOpen((o) => !o)}
          className="btn btn-ghost-field btn-sm"
        >
          <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            {open ? <path d="M5 5l10 10M15 5L5 15" /> : <path d="M3 6h14M3 10h14M3 14h14" />}
          </svg>
          Menu
        </button>
      </div>
      <div id="app-nav" className={`${open ? "flex" : "hidden"} md:flex md:h-full`}>
        {children}
      </div>
    </>
  );
}
