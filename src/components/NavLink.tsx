"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// Sidebar link that marks itself as the current page. Inbox views match on ?view=.
export default function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [path, query] = href.split("?");
  const view = new URLSearchParams(query).get("view");
  const active = pathname === path && (view === null || (params.get("view") ?? "open") === view);
  return (
    <Link href={href} className="nav-link" aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  );
}
