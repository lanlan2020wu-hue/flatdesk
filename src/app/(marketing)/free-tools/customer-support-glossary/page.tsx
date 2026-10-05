import Link from "next/link";
import ToolShell from "@/components/free-tools/ToolShell";
import { freeToolMeta } from "@/lib/free-tool-meta";
import { freeTool, freeToolPath, toolBySlug } from "@/lib/free-tools";
import { GLOSSARY } from "@/lib/glossary";
import { SITE } from "@/lib/site";

const SLUG = "customer-support-glossary";
export const metadata = freeToolMeta(SLUG);

const TERMS = [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term));
// Each letter jumps to the first term starting with it.
const initial = (term: string) => term[0].toUpperCase();
const LETTERS = TERMS.filter((t, i) => i === 0 || initial(TERMS[i - 1].term) !== initial(t.term)).map((t) => ({ letter: initial(t.term), id: t.id }));

export default function Page() {
  const tool = toolBySlug(SLUG);
  const url = `${SITE.url}${freeToolPath(SLUG)}`;
  const schema = {
    "@type": "DefinedTermSet",
    "@id": `${url}#terms`,
    name: tool.name,
    url,
    hasDefinedTerm: TERMS.map((t) => ({ "@type": "DefinedTerm", name: t.term, description: t.definition, url: `${url}#${t.id}`, inDefinedTermSet: `${url}#terms` })),
  };
  return (
    <ToolShell tool={tool} schema={[schema]}>
      <nav aria-label="Jump to letter" className="flex flex-wrap gap-1.5 text-sm">
        {LETTERS.map(({ letter, id }) => (
          <a key={letter} href={`#${id}`} className="num grid size-8 place-items-center rounded-md border border-line text-muted transition-colors hover:border-line-strong hover:text-ink">{letter}</a>
        ))}
      </nav>
      <dl className="grid max-w-3xl border-b border-line">
        {TERMS.map((t) => {
          const calc = t.tool ? freeTool(t.tool) : undefined;
          return (
            <div key={t.id} id={t.id} className="grid scroll-mt-24 gap-1.5 border-t border-line py-5">
              <dt className="font-display text-xl">
                <a href={`#${t.id}`} className="hover:text-accent">{t.term}</a>
                {t.aka && <span className="ml-2 font-sans text-sm font-normal tracking-normal text-muted">also: {t.aka}</span>}
              </dt>
              <dd className="text-muted">{t.definition}</dd>
              {calc && (
                <dd className="text-sm">
                  <Link href={freeToolPath(calc.slug)} className="link text-accent">Work it out: {calc.name}</Link>
                </dd>
              )}
            </div>
          );
        })}
      </dl>
    </ToolShell>
  );
}
