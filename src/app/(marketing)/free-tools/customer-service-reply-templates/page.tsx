import CopyButton from "@/components/free-tools/CopyButton";
import ToolShell from "@/components/free-tools/ToolShell";
import { freeToolMeta } from "@/lib/free-tool-meta";
import { freeToolPath, toolBySlug } from "@/lib/free-tools";
import { TEMPLATE_COUNT, TEMPLATE_GROUPS } from "@/lib/reply-templates";
import { SITE } from "@/lib/site";

const SLUG = "customer-service-reply-templates";
export const metadata = freeToolMeta(SLUG);

const RULES = [
  ["Lead with the answer.", "The first line says what happened or what you did, not that you're sorry for any inconvenience."],
  ["One ask per reply.", "If you need three things from the customer, number them in one message so it takes one round trip."],
  ["Give a time, then keep it.", "\"By Thursday at 3pm\" beats \"shortly\". If you'll miss it, write before it passes."],
  ["Say no plainly.", "A vague maybe gets another email. A clear no with an alternative usually ends the thread."],
  ["Make it theirs.", "A template is a starting point. Fix the details, cut what doesn't apply, and read it once as the customer would."],
];

export default function Page() {
  const tool = toolBySlug(SLUG);
  const schema = {
    "@type": "ItemList",
    name: tool.name,
    numberOfItems: TEMPLATE_COUNT,
    itemListElement: TEMPLATE_GROUPS.flatMap((g) => g.templates).map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: t.title,
      url: `${SITE.url}${freeToolPath(SLUG)}#${t.id}`,
    })),
  };
  return (
    <ToolShell tool={tool} schema={[schema]}>
      <nav aria-label="Template categories" className="flex flex-wrap gap-2 text-sm">
        {TEMPLATE_GROUPS.map((g) => (
          <a key={g.id} href={`#${g.id}`} className="rounded-md border border-line px-2.5 py-1 text-muted transition-colors hover:border-line-strong hover:text-ink">
            {g.name} <span className="num">{g.templates.length}</span>
          </a>
        ))}
      </nav>

      <section className="grid max-w-3xl gap-4">
        <h2 className="font-display text-3xl">Five rules these templates follow</h2>
        <dl className="grid gap-3">
          {RULES.map(([rule, why]) => (
            <div key={rule}>
              <dt className="inline font-medium">{rule} </dt>
              <dd className="inline text-muted">{why}</dd>
            </div>
          ))}
        </dl>
      </section>

      {TEMPLATE_GROUPS.map((g) => (
        <section key={g.id} id={g.id} aria-labelledby={`${g.id}-h`} className="grid scroll-mt-24 gap-5">
          <h2 id={`${g.id}-h`} className="font-display text-3xl">{g.name}</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {g.templates.map((t) => (
              <article key={t.id} id={t.id} className="card grid scroll-mt-24 content-start gap-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-medium">
                    <a href={`#${t.id}`} className="hover:text-accent">{t.title}</a>
                  </h3>
                  <CopyButton text={t.body} />
                </div>
                <p className="text-sm text-muted">{t.when}</p>
                <pre className="overflow-x-auto rounded-md border border-line bg-surface-2 p-4 font-sans text-sm leading-relaxed whitespace-pre-wrap">{t.body}</pre>
              </article>
            ))}
          </div>
        </section>
      ))}
    </ToolShell>
  );
}
