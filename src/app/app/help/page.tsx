import Link from "next/link";
import { and, count, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { ensureHelpSlug, excerpt, HELP_SLUG_RULE, helpUrl } from "@/lib/help";
import { SITE } from "@/lib/site";
import { saveHelpSlugAction } from "./actions";

export const metadata = { title: "Help center" };

const host = SITE.url.replace(/^https?:\/\//, "");

export default async function HelpCenterAdmin({ searchParams }: PageProps<"/app/help">) {
  const s = await requireSession();
  const { error, saved } = await searchParams;
  const [helpSlug, list] = await Promise.all([
    ensureHelpSlug(s.orgId),
    db.select().from(schema.articles).where(eq(schema.articles.orgId, s.orgId)).orderBy(desc(schema.articles.published), desc(schema.articles.updatedAt)),
  ]);
  const [{ n: live }] = await db.select({ n: count() }).from(schema.articles).where(and(eq(schema.articles.orgId, s.orgId), eq(schema.articles.published, true)));
  const url = helpUrl(helpSlug);

  return (
    <div className="grid max-w-3xl gap-12 px-4 py-6 md:px-8 md:py-8">
      <section className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid max-w-xl gap-1">
            <h1 className="font-display text-3xl">Help center</h1>
            <p className="text-sm text-muted">
              Articles your customers can search on their own. The AI reads published articles too, and links to them in its answers.
            </p>
          </div>
          {!s.viewer && <Link href="/app/help/new" className="btn btn-primary">New article</Link>}
        </div>
        <p className="text-sm">
          {live === 0 ? "Nothing is published yet. Your help center is" : `${live} published ${live === 1 ? "article" : "articles"} at`}{" "}
          <a href={url} target="_blank" rel="noopener" className="link font-medium text-accent">{url.replace(/^https?:\/\//, "")}</a>
        </p>
        {list.length > 0 ? (
          <ul className="card divide-y divide-line overflow-hidden">
            {list.map((a) => (
              <li key={a.id}>
                <Link href={`/app/help/${a.id}`} className="grid gap-1 px-5 py-4 transition-colors hover:bg-surface-2/60">
                  <span className="flex items-center justify-between gap-3">
                    <span className="truncate font-medium">{a.title}</span>
                    {a.published ? (
                      <span className="pill shrink-0 bg-accent-soft text-accent">Published</span>
                    ) : (
                      <span className="pill shrink-0 bg-surface-2 text-muted">Draft</span>
                    )}
                  </span>
                  <span className="truncate text-sm text-muted">{excerpt(a.body, 200)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-muted">
            <p className="font-medium text-ink">Start with the questions you answer most.</p>
            <p className="mt-1 max-w-xl">
              Your macros are a good place to start, since each is an answer your team already sends. Shipping, refunds, password resets and plan changes are common first articles.
            </p>
          </div>
        )}
      </section>

      <section className="grid gap-4 border-t border-line pt-6">
        <h2 className="text-lg font-semibold">Address</h2>
        <form action={saveHelpSlugAction} className="grid gap-3 text-sm">
          <label htmlFor="helpSlug" className="font-medium">Your help center lives at</label>
          <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
            <span className="text-muted">{host}/help/</span>
            <input
              id="helpSlug"
              name="helpSlug"
              required
              defaultValue={helpSlug}
              disabled={s.role !== "admin"}
              pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]"
              title={HELP_SLUG_RULE}
              className="field min-w-0 flex-1 font-normal"
            />
          </div>
          {error && <p role="alert" className="text-warn">{String(error)}</p>}
          {saved === "address" && <p className="text-accent">Saved. Old links to the previous address no longer work.</p>}
          <p className="text-muted">
            Link to it from your site and email signature so customers find answers before they write in.
            {s.role !== "admin" && " Only admins can change the address."}
          </p>
          {s.role === "admin" && <button className="btn btn-secondary w-max">Save address</button>}
        </form>
      </section>
    </div>
  );
}
