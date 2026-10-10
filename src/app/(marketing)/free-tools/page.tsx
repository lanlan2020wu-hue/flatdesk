import Link from "next/link";
import JsonLd from "@/components/JsonLd";
import { FREE_TOOLS, freeToolPath } from "@/lib/free-tools";
import { breadcrumbs, pageMeta } from "@/lib/seo";
import { SITE } from "@/lib/site";

export const metadata = pageMeta({
  title: "Free tools for customer support teams",
  description:
    "Free calculators and resources for support teams: agent staffing (Erlang C), SLA due times, CSAT and NPS with margin of error, reply templates and a support glossary. No signup.",
  path: "/free-tools",
  image: "/og/free-tools/index",
});

export default function FreeToolsPage() {
  return (
    <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-14 px-4 pt-14 sm:px-6 sm:pt-20">
      <JsonLd
        data={[
          breadcrumbs([{ name: "Free tools", path: "/free-tools" }]),
          {
            "@type": "CollectionPage",
            name: "Free tools for customer support teams",
            url: `${SITE.url}/free-tools`,
            hasPart: FREE_TOOLS.map((t) => ({ "@type": "WebPage", name: t.name, url: `${SITE.url}${freeToolPath(t.slug)}` })),
          },
        ]}
      />
      <div>
        <header className="grid max-w-3xl gap-4">
          <h1 style={{ "--d": 1 } as React.CSSProperties} className="enter font-display text-[2.6rem] sm:text-6xl">Free tools for customer support teams</h1>
          <p style={{ "--d": 2 } as React.CSSProperties} className="enter text-lg text-muted">
            Calculators and references for the questions support leads answer every week: how many people to schedule, when a ticket is due, and whether a change in CSAT is real. No signup, nothing to install, and every formula is shown.
          </p>
        </header>
      </div>
      <ul className="grid gap-4 md:grid-cols-2">
        {FREE_TOOLS.map((t, i) => (
          <li key={t.slug} style={{ "--d": 3 + i } as React.CSSProperties} className="enter">
            <Link href={freeToolPath(t.slug)} className="card grid h-full content-start gap-2 p-6 transition-colors hover:border-line-strong">
              <h2 className="font-display text-2xl">{t.name}</h2>
              <p className="text-muted">{t.description}</p>
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">
        Made by <Link href="/" className="link text-ink">Flatdesk</Link>, a help desk for small support teams at one flat price per agent. Comparing help desk bills? Try the <Link href="/calculator" className="link text-ink">help desk cost calculator</Link>.
      </p>
    </div>
  );
}
