import Link from "next/link";
import JsonLd from "@/components/JsonLd";
import CopyButton from "@/components/free-tools/CopyButton";
import { FREE_TOOLS, freeToolPath, type FreeTool } from "@/lib/free-tools";
import { breadcrumbs } from "@/lib/seo";
import { SITE } from "@/lib/site";

// The frame every free tool page shares: headline, the tool, sources, a
// ready-made link for anyone citing it, the other tools, and one line about
// Flatdesk at the very end.
export default function ToolShell({ tool, schema = [], children }: { tool: FreeTool; schema?: Record<string, unknown>[]; children: React.ReactNode }) {
  const path = freeToolPath(tool.slug);
  const url = `${SITE.url}${path}`;
  const linkHtml = `<a href="${url}">${tool.name}</a>`;
  const others = FREE_TOOLS.filter((t) => t.slug !== tool.slug);
  return (
    <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-16 px-4 pt-14 sm:px-6 sm:pt-20">
      <JsonLd data={[breadcrumbs([{ name: "Free tools", path: "/free-tools" }, { name: tool.name, path }]), ...schema]} />
      <header className="grid max-w-3xl gap-4">
        <p style={{ "--d": 0 } as React.CSSProperties} className="enter text-sm text-muted">
          <Link href="/free-tools" className="link">Free tools for support teams</Link>
        </p>
        <h1 style={{ "--d": 1 } as React.CSSProperties} className="enter font-display text-[2.4rem] sm:text-5xl">{tool.title}</h1>
        <p style={{ "--d": 2 } as React.CSSProperties} className="enter text-lg text-muted">{tool.intro}</p>
      </header>

      {children}

      <section className="grid gap-8 border-t border-line pt-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {tool.sources.length > 0 && (
          <div className="grid content-start gap-3">
            <h2 className="font-display text-2xl">Sources</h2>
            <ul className="grid gap-1.5 text-sm text-muted">
              {tool.sources.map((s) => (
                <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer" className="link">{s.label}</a></li>
              ))}
            </ul>
          </div>
        )}
        <div className="grid content-start gap-3">
          <h2 className="font-display text-2xl">Link to this page</h2>
          <p className="text-sm text-muted">Free to use and share. If it helped, a link back is the best thanks.</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="num min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-line bg-surface-2 px-3 py-2 text-xs">{linkHtml}</code>
            <CopyButton text={linkHtml} label="Copy link HTML" />
          </div>
        </div>
      </section>

      <section className="grid gap-5">
        <h2 className="font-display text-2xl">More free tools</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {others.map((t) => (
            <li key={t.slug}>
              <Link href={freeToolPath(t.slug)} className="card grid h-full gap-1.5 p-4 transition-colors hover:border-line-strong">
                <span className="font-medium">{t.name}</span>
                <span className="text-sm text-muted">{t.short}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">
          Made by <Link href="/" className="link text-ink">Flatdesk</Link>, a help desk for small support teams at one flat price per agent.
        </p>
      </section>
    </div>
  );
}
