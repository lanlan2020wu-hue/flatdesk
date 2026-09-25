import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import ImportRunner from "@/components/ImportRunner";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { timeAgo } from "@/lib/format";
import { IMPORT_STATUS, importReport, KIND_LABEL } from "@/lib/import/report";
import { cancelImportAction } from "../actions";

export const metadata = { title: "Import" };

export default async function ImportDetailPage({ params }: PageProps<"/app/import/[id]">) {
  const s = await requireAdmin();
  const { id } = await params;
  const report = await importReport(s.orgId, id).catch(() => null);
  if (!report) notFound();
  const { job, adapter, phases, counts, issues } = report;
  const running = job.status === "running";
  const phaseIdx = phases.findIndex((p) => p.kind === job.phase);
  const unlinked = await db
    .select({ name: schema.externalAgents.name, email: schema.externalAgents.email })
    .from(schema.externalAgents)
    .where(and(eq(schema.externalAgents.orgId, s.orgId), eq(schema.externalAgents.source, job.source), isNull(schema.externalAgents.linkedUserId), eq(schema.externalAgents.active, true)));
  const invitable = unlinked.filter((a) => a.email);
  const status = IMPORT_STATUS[job.status];

  return (
    <div className="grid max-w-3xl gap-6 px-4 py-6 md:px-8 md:py-8">
      <header className="grid gap-2">
        <Link href="/app/import" className="link w-max text-sm text-muted">
          Import
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl">
            {adapter.name} <span className="text-muted">· {job.account}</span>
          </h1>
          <span className={`pill ${status.tone}`}>{status.label}</span>
        </div>
        <p className="text-sm text-muted">
          Started {timeAgo(job.createdAt)}
          {job.finishedAt && `, ended ${timeAgo(job.finishedAt)}`}
        </p>
      </header>

      {running && <ImportRunner id={job.id} retryAt={job.retryAt?.toISOString() ?? null} />}
      {job.status === "failed" && (
        <p role="alert" className="rounded-lg bg-warn-soft px-4 py-3 text-warn">
          {job.error} Everything read so far is kept. <Link href={`/app/import/new/${job.source}`} className="link">Start again</Link> to continue; nothing is added twice.
        </p>
      )}

      <section className="card grid gap-1 p-2 sm:p-3" aria-label="Progress">
        {phases.map((p, i) => {
          const c = counts[p.kind];
          const state = job.status === "done" || i < phaseIdx ? "done" : i === phaseIdx && running ? "now" : i === phaseIdx ? "stopped" : "next";
          return (
            <div key={p.kind} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2 text-sm">
              <span aria-hidden="true" className="grid size-5 place-items-center">
                {state === "done" ? (
                  <svg viewBox="0 0 20 20" className="size-5 text-accent" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 10.5l3.2 3.2L15 7" />
                  </svg>
                ) : state === "now" ? (
                  <span className="size-3 animate-pulse rounded-full bg-accent" />
                ) : (
                  <span className="size-2 rounded-full bg-line-strong" />
                )}
              </span>
              <span className={state === "next" ? "text-muted" : ""}>{p.label}</span>
              <span className="num text-xs text-muted">
                {c ? (
                  <>
                    {c.imported} imported
                    {c.kept > 0 && ` · ${c.kept} kept for reference`}
                    {state === "now" && c.found > c.imported + c.kept && ` · ${c.found - c.imported - c.kept} to go`}
                  </>
                ) : state === "done" ? (
                  "none"
                ) : null}
              </span>
            </div>
          );
        })}
      </section>

      {job.notes.length > 0 && (
        <section className="grid gap-2">
          <h2 className="eyebrow">About this import</h2>
          <ul className="grid gap-1.5 text-sm text-muted">
            {job.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="grid gap-1">
            <h2 className="font-medium">What didn&apos;t map exactly</h2>
            <p className="text-sm text-muted">Nothing here was thrown away. Originals are in the import archive and on each ticket.</p>
          </div>
          <div className="flex gap-2">
            <a href={`/app/import/${job.id}/issues`} className="btn btn-secondary btn-sm">
              Download report
            </a>
            <a href={`/app/import/${job.id}/archive`} className="btn btn-secondary btn-sm">
              Download archive
            </a>
          </div>
        </div>
        {issues.length === 0 ? (
          <p className="card p-5 text-sm text-muted">{running ? "Nothing so far." : "Everything mapped cleanly."}</p>
        ) : (
          <ul className="card divide-y divide-line">
            {issues.map((i) => (
              <li key={`${i.kind}:${i.issue}`}>
                <details className="group px-5 py-3 text-sm">
                  <summary className="flex cursor-pointer items-start justify-between gap-3">
                    <span className="grid gap-0.5">
                      <span>{i.issue}</span>
                      <span className="text-xs text-muted">{KIND_LABEL[i.kind] ?? i.kind}</span>
                    </span>
                    <span className="num shrink-0 text-muted">{i.count}</span>
                  </summary>
                  <p className="mt-2 text-muted">
                    For example: {i.examples.join(", ")}
                    {i.count > i.examples.length && `, and ${i.count - i.examples.length} more (see the report)`}
                  </p>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      {job.status === "done" && (
        <section className="card grid gap-3 p-5 sm:p-6">
          <h2 className="font-medium">Next</h2>
          <ul className="grid gap-2 text-sm">
            {invitable.length > 0 && (
              <li>
                <Link href="/app/welcome?step=invite" className="link">
                  Invite {invitable.length} {invitable.length === 1 ? "agent" : "agents"} from {adapter.name}
                </Link>
                <span className="text-muted"> so their tickets and rules follow them.</span>
              </li>
            )}
            <li>
              <Link href="/app/macros" className="link">Review imported macros and rules</Link>
              <span className="text-muted">, including the actions Flatdesk couldn&apos;t apply.</span>
            </li>
            <li>
              <Link href="/app/inbox?view=open" className="link">Open the inbox</Link>
            </li>
          </ul>
        </section>
      )}

      {running && (
        <form action={cancelImportAction}>
          <input type="hidden" name="id" value={job.id} />
          <button className="link text-sm text-muted">Cancel import</button>
        </form>
      )}
    </div>
  );
}
