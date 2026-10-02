import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import SlaBadge from "@/components/SlaBadge";
import TagInput from "@/components/TagInput";
import { WaitFor } from "@/components/onboarding";
import { aiConfigured, monthKey, TEST_AI_BUDGET_USD } from "@/lib/ai";
import { webhookLabel } from "@/lib/alerts";
import { requireOpenPage } from "@/lib/auth";
import { emailConfig } from "@/lib/email";
import { shortDuration, slaState, targetLabel } from "@/lib/sla";
import { orgTags } from "@/lib/tickets";
import { AGES, listTestTickets, ownEmail, SCENARIOS, testAiSpent, type TestRow } from "@/lib/test-tickets";
import { clearTestTicketsAction, createTestTicketAction, writeBackAction } from "./actions";

export const metadata = { title: "Test tickets" };

const field = "field font-normal";
type Org = typeof schema.orgs.$inferSelect;

function AgeSelect({ id }: { id: string }) {
  return (
    <select id={id} name="age" className={`${field} w-auto`} defaultValue="now">
      {AGES.map((a) => (
        <option key={a.id} value={a.id}>{a.label}</option>
      ))}
    </select>
  );
}

function aiLine(r: TestRow, org: Org): { head: string; detail: string | null } {
  if (r.ai?.kind === "draft") return { head: "The AI is reading it…", detail: null };
  if (r.ai?.kind === "resolution") return { head: "The AI answered and emailed the customer", detail: r.ai.reason };
  if (r.ai?.kind === "followup") return { head: r.resolvedByAi ? "The AI answered the follow-up" : "The AI looked at the follow-up", detail: r.ai.reason };
  if (r.ai?.kind === "handoff") return { head: "The AI handed it to your team", detail: r.ai.reason };
  if (r.note) return { head: "The AI didn't answer", detail: r.note };
  if (!aiConfigured()) return { head: "The AI isn't connected on this server", detail: null };
  if (!org.aiEnabled) return { head: "The AI is off in Settings", detail: null };
  return { head: "Waiting for the AI", detail: null };
}

function Row({ r, org, email }: { r: TestRow; org: Org; email: string }) {
  const ai = aiLine(r, org);
  const sla = slaState(r, org);
  return (
    <li className="grid gap-3 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-baseline gap-2">
          <Link href={`/app/tickets/${r.number}`} className="num text-sm text-muted hover:text-ink">#{r.number}</Link>
          <Link href={`/app/tickets/${r.number}`} className="truncate font-medium hover:text-accent">{r.subject}</Link>
        </span>
        <span className="text-sm text-muted">
          <span className="capitalize">{r.channel}</span> · <span className="capitalize">{r.status}</span>
        </span>
      </div>
      <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
        <dt className="text-muted">From</dt>
        <dd className="truncate">{r.customer}</dd>
        <dt className="text-muted">Assigned</dt>
        <dd>
          {r.assignee ?? "Nobody"}
          {r.tags.length > 0 && <span className="text-muted"> · tags {r.tags.join(", ")}</span>}
        </dd>
        <dt className="text-muted">AI</dt>
        <dd className="grid gap-0.5">
          <span>{ai.head}</span>
          {ai.detail && <span className="text-muted">{ai.detail}</span>}
          {r.ai && r.ai.sources.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
              Used
              {r.ai.sources.map((src) => (
                <span key={src} className="chip">{src}</span>
              ))}
            </span>
          )}
        </dd>
        <dt className="text-muted">Reply email</dt>
        <dd>
          {!emailConfig.apiKey
            ? "Email isn't set up on this server, so replies stay in Flatdesk."
            : r.emailError
              ? `Didn't send: ${r.emailError}`
              : r.messages > 1
                ? `Sent to ${email}. Reply to it to write back as the customer.`
                : "Nothing sent yet."}
        </dd>
        <dt className="text-muted">First reply</dt>
        <dd className="flex flex-wrap items-center gap-2">
          {!sla ? (
            org.firstResponseMinutes ? "No target for this ticket now." : "No reply target set."
          ) : sla.kind === "met" || sla.kind === "missed" ? (
            `${sla.kind === "met" ? "Met" : "Missed"} the target, first reply after ${shortDuration(sla.took)}.`
          ) : (
            <SlaBadge state={sla} hours={org.businessHours} />
          )}
        </dd>
      </dl>
      <details className="text-sm">
        <summary className="w-max cursor-pointer text-accent">Write back as the customer</summary>
        <form action={writeBackAction} className="mt-2 grid max-w-xl gap-2">
          <input type="hidden" name="number" value={r.number} />
          <label className="sr-only" htmlFor={`body-${r.number}`}>What the customer says</label>
          <textarea id={`body-${r.number}`} name="body" required rows={3} className={field} placeholder="Thanks, but that didn't work." />
          <button className="btn btn-secondary btn-sm w-max">Send as the customer</button>
        </form>
      </details>
    </li>
  );
}

export default async function TestTicketsPage({ searchParams }: PageProps<"/app/test-tickets">) {
  const s = await requireOpenPage();
  if (s.role !== "admin") redirect("/app/inbox");
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const [org, rows, email, spent, tags] = await Promise.all([
    db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId) }),
    listTestTickets(s.orgId),
    ownEmail(s.orgId, s.userId),
    testAiSpent(s.orgId, monthKey()),
    orgTags(s.orgId),
  ]);
  if (!org) redirect("/app/inbox");
  const aiOn = aiConfigured() && org.aiEnabled;
  const waiting = aiOn && rows.some((r) => r.ai?.kind === "draft" || (!r.ai && !r.note && r.status === "open" && r.messages === 1));
  const plus = email.replace("@", "+refund@");

  return (
    <div className="grid max-w-4xl gap-8 px-4 py-6 md:px-8 md:py-8">
      <header className="grid gap-1.5">
        <h1 className="page-title">Test tickets</h1>
        <p className="max-w-2xl text-muted">
          Play the customer and see what Flatdesk does. A test ticket goes through the same steps as a real one: your rules, the AI, the reply
          email, alerts and the reply target. It&apos;s marked Test, left out of reports and never counts toward your AI allowance.
        </p>
      </header>

      {error && <p role="alert" className="rounded-lg border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">{error}</p>}

      <section className="grid gap-2 text-sm" aria-label="Where things go">
        <p>
          <span className="text-muted">Replies go to </span>
          {emailConfig.apiKey ? `${email || "your email"} (ready-made ones to a plus version of it)` : "nobody: email isn't set up on this server"}
          <span className="text-muted"> · AI </span>
          {!aiConfigured() ? "not connected" : !org.aiEnabled ? <Link href="/app/settings" className="link text-accent">off</Link> : `on, $${Math.max(0, TEST_AI_BUDGET_USD - spent).toFixed(2)} of test budget left this month`}
          <span className="text-muted"> · Alerts </span>
          {org.alertWebhookUrl ? webhookLabel(org.alertWebhookUrl) : <Link href="/app/settings" className="link text-accent">not set up</Link>}
          {org.alertLastError && <span className="text-warn"> (last one failed: {org.alertLastError})</span>}
          <span className="text-muted"> · Reply target </span>
          {org.firstResponseMinutes ? targetLabel(org.firstResponseMinutes) : "none"}
        </p>
      </section>

      <section className="grid gap-3" aria-labelledby="situations">
        <h2 id="situations" className="font-medium">Try a situation</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {SCENARIOS.map((sc) => (
            <li key={sc.id} className="card grid content-between gap-3 p-4">
              <div className="grid gap-1">
                <p className="font-medium">{sc.label}</p>
                <p className="text-sm text-muted">&ldquo;{sc.subject}&rdquo; by {sc.channel}</p>
                <p className="text-sm">{sc.expect}</p>
              </div>
              <form action={createTestTicketAction} className="flex flex-wrap items-center gap-2 text-sm">
                <input type="hidden" name="scenario" value={sc.id} />
                <label className="text-muted" htmlFor={`age-${sc.id}`}>Arrived</label>
                <AgeSelect id={`age-${sc.id}`} />
                <button className="btn btn-primary btn-sm">Send it in</button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-3" aria-labelledby="own">
        <h2 id="own" className="font-medium">Write your own</h2>
        <form action={createTestTicketAction} className="card grid gap-4 p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid content-start gap-1.5 text-sm font-medium" htmlFor="email">
              Customer email
              <input id="email" name="email" type="email" required defaultValue={email} className={field} />
              <span className="text-xs font-normal text-muted">Yours, or a plus version like {plus} to play another customer.</span>
            </label>
            <label className="grid content-start gap-1.5 text-sm font-medium" htmlFor="name">Customer name<input id="name" name="name" className={field} /></label>
          </div>
          <label className="grid gap-1.5 text-sm font-medium" htmlFor="subject">Subject<input id="subject" name="subject" required className={field} /></label>
          <label className="grid gap-1.5 text-sm font-medium" htmlFor="body">What they write<textarea id="body" name="body" required rows={5} className={field} /></label>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="grid gap-1.5 text-sm font-medium" htmlFor="channel">
              Came in by
              <select id="channel" name="channel" className={field} defaultValue="email">
                <option value="email">Email</option>
                <option value="chat">Chat</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium" htmlFor="tags">Tags<TagInput tags={tags} id="tags" name="tags" placeholder="billing" className={field} /></label>
            <label className="grid gap-1.5 text-sm font-medium" htmlFor="age-own">Arrived<AgeSelect id="age-own" /></label>
          </div>
          <button className="btn btn-primary w-max">Send it in</button>
        </form>
      </section>

      <section className="grid gap-3" aria-labelledby="yours">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="yours" className="font-medium">Your test tickets</h2>
          {rows.length > 0 && (
            <form action={clearTestTicketsAction}>
              <button className="btn btn-secondary btn-sm">Delete all test tickets</button>
            </form>
          )}
        </div>
        {waiting && <WaitFor label="The AI is working. This page updates on its own." everyMs={3000} forMs={3 * 60_000} />}
        {rows.length === 0 ? (
          <p className="text-sm text-muted">None yet. Send one in above and it shows up here and in the inbox.</p>
        ) : (
          <ul className="card divide-y divide-line">
            {rows.map((r) => (
              <Row key={r.number} r={r} org={org} email={r.customer.match(/[^\s(]+@[^\s)]+/)?.[0] ?? email} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
