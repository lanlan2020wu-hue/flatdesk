import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { SITE } from "@/lib/site";
import { helpWords, isRtl, nativeName } from "@/lib/help-i18n";
import { type HelpCenter, helpHref } from "./data";

// A team's public help center. Plain and quiet on purpose: it carries the
// team's name, not ours, apart from a small credit in the footer.
// `here` is the path of this page within the help center, for the language menu.
export default function HelpFrame({ org, lang, here, children }: { org: HelpCenter; lang: string; here: string; children: React.ReactNode }) {
  const w = helpWords(lang);
  return (
    <div lang={lang} dir={isRtl(lang) ? "rtl" : "ltr"} className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link href={helpHref(org, "", lang)} className="font-display text-xl">
            {org.name} <span className="text-muted">{w.help}</span>
          </Link>
          {org.languages.length > 1 && (
            <nav aria-label={w.language} className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
              {org.languages.map((l) =>
                l === lang ? (
                  <span key={l} lang={l} aria-current="true" className="font-medium">{nativeName(l)}</span>
                ) : (
                  <Link key={l} lang={l} hrefLang={l} href={`${org.base}${here}?lang=${l}`} className="link text-muted">{nativeName(l)}</Link>
                ),
              )}
            </nav>
          )}
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
        {children}
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-4 text-xs text-muted sm:px-6">
          <span className="inline-flex items-center gap-2" lang="en" dir="ltr">
            <LogoMark className="size-4" />
            <span>
              Help center by <a href={SITE.url} className="link">Flatdesk</a>
            </span>
          </span>
          {/* The chat window asks for the visitor's email each time, and the AI answers there. */}
          <span>
            {w.stuck}{" "}
            <a href={`/chat/${org.widgetKey}`} target="_blank" rel="noreferrer" className="link text-accent">{w.chat}</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
