import Link from "next/link";
import { notFound } from "next/navigation";
import { LogoMark } from "@/components/Logo";
import { helpCenter } from "./data";

// A team's public help center. Plain and quiet on purpose: it carries the
// team's name, not ours, apart from a small credit in the footer.
export default async function HelpLayout({ children, params }: LayoutProps<"/help/[org]">) {
  const { org: slug } = await params;
  const org = await helpCenter(slug);
  if (!org) notFound();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
          <Link href={`/help/${org.helpSlug}`} className="font-display text-xl">
            {org.name} <span className="text-muted">Help</span>
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
        {children}
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-4 text-xs text-muted sm:px-6">
          <span className="inline-flex items-center gap-2">
            <LogoMark className="size-4" />
            <span>
              Help center by <Link href="/" className="link">Flatdesk</Link>
            </span>
          </span>
          {/* The chat window asks for the visitor's email each time, and the AI answers there. */}
          <span>
            Still stuck?{" "}
            <a href={`/chat/${org.widgetKey}`} target="_blank" rel="noreferrer" className="link text-accent">Chat with us</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
