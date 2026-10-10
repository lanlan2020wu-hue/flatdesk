import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { tagCounts } from "@/lib/tag-manager";
import { deleteTagAction, renameTagAction } from "../../actions";

export const metadata = { title: "Tags" };

// Tidy the tags the team has built up: rename one, fold two together, or take one off everything.
export default async function TagsPage({ searchParams }: PageProps<"/app/settings/tags">) {
  const s = await requireSession();
  if (s.role !== "admin") notFound();
  const { msg } = await searchParams;
  const tags = await tagCounts(s.orgId);
  return (
    <div className="grid max-w-3xl gap-6 px-4 py-6 md:px-8 md:py-8">
      <div className="grid gap-2">
        <Link href="/app/settings" className="link w-max text-sm text-accent">Settings</Link>
        <h1 className="page-title">Tags</h1>
        <p className="text-muted">Renaming a tag also updates macros, assignment rules and saved views that use it. Rename it to a tag that already exists to fold the two together.</p>
      </div>
      {typeof msg === "string" && <p role="status" className="text-sm">{msg.slice(0, 200)}</p>}
      {tags.length === 0 ? (
        <p className="text-muted">No tags yet.</p>
      ) : (
        <ul className="grid divide-y divide-line border-y border-line">
          {tags.map((t) => (
            <li key={t.tag} className="flex flex-wrap items-center gap-3 py-3">
              <span className="min-w-32 font-medium">{t.tag}</span>
              <span className="num text-sm text-muted">{t.tickets} {t.tickets === 1 ? "ticket" : "tickets"}</span>
              <form action={renameTagAction} className="ml-auto flex gap-2">
                <input type="hidden" name="from" value={t.tag} />
                <input name="to" required placeholder="New name" aria-label={`New name for ${t.tag}`} className="field field-sm w-40" />
                <button className="btn btn-secondary btn-sm">Rename</button>
              </form>
              <form action={deleteTagAction}>
                <input type="hidden" name="tag" value={t.tag} />
                <button className="btn btn-secondary btn-sm text-warn">Remove</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
