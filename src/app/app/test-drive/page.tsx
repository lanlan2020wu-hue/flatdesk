import { eq } from "drizzle-orm";
import Link from "next/link";
import { db, schema } from "@/db";
import TestDriveRunner from "@/components/TestDriveRunner";
import { requireOpenPage } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai";
import { pickTickets, scorecard, spentUsd, TEST_DRIVE, testDriveDrafts, VERDICT_LABEL, type DraftRow, type Verdict } from "@/lib/test-drive";
import { rateDraftAction, startTestDriveAction } from "./actions";

export const metadata = { title: "AI test drive" };

const VERDICT_TONE: Record<Verdict, string> = {
  send: "bg-accent-soft text-accent border-accent/30",
  edit: "bg-warn-soft text-warn border-warn/30",
  wrong: "bg-surface-2 text-ink border-line-strong",
};

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="grid gap-0.5">
      <span className="num font-display text-2xl">{value}</span>
      <span className="text-sm">{label}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

function Text({ children }: { children: string }) {
  return <p className="max-h-64 overflow-y-auto text-sm leading-relaxed break-words whitespace-pre-wrap">{children}</p>;
}

function Row({ r }: { r: DraftRow }) {
  return (
    <li className="card grid gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <Link href={`/app/tickets/${r.ticketNumber}`} className="num text-sm text-muted hover:text-ink">#{r.ticketNumber}</Link>
          <span className="truncate font-medium">{r.subject}</span>
        </span>
        {r.customer && <span className="truncate text-sm text-muted">{r.customer}</span>}
      </div>
      {r.question && (
        <details className="rounded-lg bg-surface-2/60 px-3 py-2 text-sm">
          <summary className="cursor-pointer text-muted">The customer asked</summary>
          <div className="mt-2">
            <Text>{r.question}</Text>
          </div>
        </details>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="grid content-start gap-2 rounded-lg border border-accent/30 p-3" aria-label="AI draft">
          <h3 className="eyebrow text-accent">AI draft</h3>
          {r.status === "queued" || r.status === "running" ? (
            <p className="text-sm text-muted">{r.status === "running" ? "Drafting…" : "Waiting its turn."}</p>
          ) : r.status !== "done" ? (
            <p className="text-sm text-muted">{r.error ?? "Not drafted."}</p>
          ) : r.decision === "answer" && r.draft ? (
            <>
              <Text>{r.draft}</Text>
              {r.sources.length > 0 && (
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  Used
                  {r.sources.map((src) => (
                    <span key={src} className="chip">{src}</span>
                  ))}
                </p>
              )}
            </>
          ) : (
            <div className="grid gap-1 text-sm">
              <p className="font-medium">Would hand this to your team</p>
              {r.reason && <p className="text-muted">{r.reason}</p>}
              <p className="text-xs text-muted">Handoffs never count toward the AI allowance.</p>
            </div>
          )}
        </section>
        <section className="grid content-start gap-2 rounded-lg border border-line p-3" aria-label="What your team sent">
          <h3 className="eyebrow">Your team sent{r.teamReplyBy ? ` · ${r.teamReplyBy}` : ""}</h3>
          {r.teamReply ? <Text>{r.teamReply}</Text> : <p className="text-sm text-muted">No reply found.</p>}
        </section>
      </div>
      {r.status === "done" && r.decision === "answer" && (
        <form action={rateDraftAction} className="flex flex-wrap items-center gap-2 text-sm">
          <input type="hidden" name="id" value={r.id} />
          <span className="text-muted">Your call:</span>
          {(Object.keys(VERDICT_LABEL) as Verdict[]).map((v) => (
            <button
              key={v}
              name="verdict"
              value={r.verdict === v ? "" : v}
              aria-pressed={r.verdict === v}
              className={`rounded-full border px-3 py-1 transition-colors ${r.verdict === v ? VERDICT_TONE[v] : "border-line text-muted hover:border-line-strong hover:text-ink"}`}
            >
              {VERDICT_LABEL[v]}
            </button>
          ))}
        </form>
      )}
    </li>
  );
}

export default async function TestDrivePage({ searchParams }: PageProps<"/app/test-drive">) {
  const s = await requireOpenPage();
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const [rows, spent, org] = await Promise.all([
    testDriveDrafts(s.orgId),
    spentUsd(s.orgId),
    db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId), columns: { aiEnabled: true } }),
  ]);
  const isAdmin = s.role === "admin";
  const active = rows.some((r) => r.status === "queued" || r.status === "running");
  const canRun = aiConfigured() && spent < TEST_DRIVE.budgetUsd;
  const eligible = rows.length === 0 ? (await pickTickets(s.orgId)).length : 0;
  const score = scorecard(rows);
  const finished = rows.filter((r) => r.status !== "queued" && r.status !== "running").length;

  return (
    <div className="grid max-w-5xl gap-8 px-4 py-6 md:px-8 md:py-8">
      <header className="grid gap-1.5">
        <h1 className="font-display text-3xl">AI test drive</h1>
        <p className="max-w-2xl text-muted">
          The AI drafts answers to your {TEST_DRIVE.tickets} most recent tickets from your macros and notes, and shows each one beside the reply your team sent. Nothing goes to customers and none of it uses your AI allowance.
        </p>
      </header>

      {org && !org.aiEnabled && (
        <p className="rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm text-muted">
          The AI is switched off in <Link href="/app/settings" className="link text-accent">Settings</Link>, so it isn&apos;t answering live tickets.
          The test drive still works, so you can judge it before turning it on.
        </p>
      )}

      {error && <p role="alert" className="rounded-lg border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">{error}</p>}

      {rows.length === 0 ? (
        <section className="card grid gap-4 p-5 sm:p-6">
          {!aiConfigured() ? (
            <p className="text-muted">The AI isn&apos;t connected on this server yet, so the test drive can&apos;t run.</p>
          ) : eligible === 0 ? (
            <div className="grid gap-2">
              <p>There are no tickets with a reply from your team yet.</p>
              <p className="text-sm text-muted">
                {isAdmin ? (
                  <>
                    <Link href="/app/import" className="link text-accent">Import your help desk history</Link> and the test drive can start right away. In the meantime,{" "}
                    <Link href="/app/welcome?step=ai" className="link text-accent">ask the AI a question yourself</Link> in setup.
                  </>
                ) : (
                  "Once your team has answered some tickets, or an admin imports your history, the test drive can start."
                )}
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-1">
                <p className="font-medium">Ready to draft {eligible} of your recent tickets</p>
                <p className="text-sm text-muted">
                  It takes a few minutes. The AI answers the customer&apos;s first message exactly as it would live, and hands off anything it
                  shouldn&apos;t answer.
                </p>
              </div>
              {isAdmin ? (
                <form action={startTestDriveAction}>
                  <button className="btn btn-primary">Start the test drive</button>
                </form>
              ) : (
                <p className="text-sm text-muted">Ask an admin to start it.</p>
              )}
            </>
          )}
        </section>
      ) : (
        <>
          {active && <TestDriveRunner />}
          <section className="card grid gap-5 p-5 sm:p-6" aria-label="Scorecard">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-medium">Scorecard</h2>
              <span className="num text-sm text-muted">
                {finished} of {rows.length} done
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
              <span className="meter block h-full rounded-full bg-accent" style={{ width: `${Math.round((finished / rows.length) * 100)}%` }} />
            </div>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
              <Stat label="Would answer" value={score.answered} hint="Replies the AI would have sent" />
              <Stat label="Would hand off" value={score.handedOff} hint="Left for your team" />
              <Stat
                label="Would send as is"
                value={score.rated ? `${score.send} of ${score.rated}` : "–"}
                hint={score.rated ? `${score.edit} need edits, ${score.wrong} wrong` : "Rate the drafts below"}
              />
              <Stat label="Macros cited" value={new Set(rows.flatMap((r) => r.sources)).size} hint="Different saved answers used" />
            </div>
            {!active && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-sm text-muted">
                <p>
                  Macros Flatdesk wrote from these same replies are left out, so the score isn&apos;t flattered. Drafts that are wrong or need
                  edits usually mean a missing macro.{" "}
                  <Link href="/app/macros" className="link text-accent">Add or fix macros</Link>, then run it again.
                </p>
                {isAdmin && canRun && (
                  <form action={startTestDriveAction}>
                    <button className="btn btn-secondary btn-sm">Run again with current macros</button>
                  </form>
                )}
              </div>
            )}
          </section>
          <ol className="grid gap-4">
            {rows.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
