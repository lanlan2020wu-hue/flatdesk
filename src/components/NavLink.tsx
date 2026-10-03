"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// Sidebar link that marks itself as the current page. Inbox views match on ?view=;
// alsoActive keeps a link marked on pages under another path (a ticket under Inbox).
export default function NavLink({ href, alsoActive, children }: { href: string; alsoActive?: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [path, query] = href.split("?");
  const view = new URLSearchParams(query).get("view");
  const active =
    (pathname === path && (view === null || (params.get("view") ?? "open") === view)) ||
    (alsoActive !== undefined && pathname.startsWith(alsoActive));
  return (
    <Link href={href} className="nav-link" aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  );
}
