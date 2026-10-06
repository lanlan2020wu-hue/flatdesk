import Link from "next/link";
import { eq } from "drizzle-orm";
import { NewWebhookActionForm } from "@/components/ActionForms";
import { db, schema } from "@/db";
import { BUILT_IN, listActions, runCounts, waitingRuns, type ActionRow } from "@/lib/ai-actions";
import { requireOpenPage } from "@/lib/auth";
import { timeAgo } from "@/lib/format";
import { listIntegrations } from "@/lib/integrations";
import { addBuiltInAction, deleteAction, saveAction, setReadsRecords } from "./server";

export const metadata = { title: "AI actions" };

const APPROVAL = {
  always: "A person approves every time",
  over_limit: "On its own up to an amount, a person approves above it",
  never: "On its own, no approval",
} as const;

function ActionCard({ a, isAdmin, counts }: { a: ActionRow; isAdmin: boolean; counts: Partial<Record<"waiting" | "done" | "failed" | "declined", number>> | undefined }) {
  const b = a.kind === "webhook" ? null : BUILT_IN[a.kind];
  const money = b?.money ?? false;
  const used = [counts?.done && `${counts.done} done`, counts?.waiting && `${counts.waiting} waiting`, counts?.declined && `${counts.declined} declined`, counts?.failed && `${counts.failed} failed`].filter(Boolean).join(", ");
  return (
    <li id={`action-${a.id}`} className="grid scroll-mt-6 gap-3 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">
          {a.name} {!a.enabled && <span className="chip ml-1">Off</span>}
          {a.lookup && <span className="chip ml-1">Lookup</span>}
        </h3>
        <span className="text-sm text-muted">{used ? `Last 30 days: ${used}` : "Not used in the last 30 days"}</span>
      </div>
      <p className="text-sm text-muted">{b ? b.describe : a.lookup ? "Calls your endpoint and gives the AI your answer." : "Calls your endpoint with what the AI filled in."}</p>
      {isAdmin ? (
        <form action={saveAction} className="grid gap-3">
          <input type="hidden" name="id" value={a.id} />
          {a.kind === "webhook" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="label">Name</span>
                <input name="name" defaultValue={a.name} maxLength={80} className="field text-sm" />
              </label>
              <label className="grid gap-1.5">
                <span className="label">Endpoint</span>
                <input name="url" defaultValue={a.url ?? ""} spellCheck={false} className="field num text-sm" />
              </label>
            </div>
          )}
          <label className="grid gap-1.5">
            <span className="label">When the AI should use it</span>
            <textarea name="whenToUse" defaultValue={a.whenToUse} rows={2} maxLength={1000} className="field text-sm" />
          </label>
          {a.kind === "webhook" && (
            <label className="grid gap-1.5">
              <span className="label">What the AI fills in</span>
              <textarea name="inputs" defaultValue={a.inputs.map((i) => `${i.name}: ${i.description}`).join("\n")} rows={2} spellCheck={false} className="field num text-sm" />
            </label>
          )}
          {!a.lookup && (
            <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
              <label className="grid gap-1.5">
                <span className="label">Runs</span>
                <select name="approval" defaultValue={a.approval} className="field text-sm">
                  <option value="always">{APPROVAL.always}</option>
                  {money && <option value="over_limit">{APPROVAL.over_limit}</option>}
                  <option value="never">{APPROVAL.never}</option>
                </select>
              </label>
              {money && (
                <label className="grid gap-1.5">
                  <span className="label">Up to</span>
                  <input name="limit" inputMode="decimal" placeholder="50.00" defaultValue={a.limitCents != null ? (a.limitCents / 100).toFixed(2) : ""} className="field num text-sm" />
                </label>
              )}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="enabled" defaultChecked={a.enabled} />
            On
          </label>
          {a.kind === "webhook" && (
            <details className="text-sm text-muted">
              <summary className="cursor-pointer">Signing secret</summary>
              <p className="num mt-2 break-all">{a.secret}</p>
            </details>
          )}
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary btn-sm">Save</button>
            <button formAction={deleteAction} className="btn btn-secondary btn-sm">
              Delete
            </button>
          </div>
        </form>
      ) : (
        <p className="text-sm">
          {a.lookup ? "Runs straight away." : APPROVAL[a.approval]}
          {a.approval === "over_limit" && a.limitCents != null ? ` (${(a.limitCents / 100).toFixed(2)})` : ""}.
        </p>
      )}
    </li>
  );
}

export default async function ActionsPage({ searchParams }: PageProps<"/app/actions">) {
  const s = await requireOpenPage();
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const isAdmin = s.role === "admin";
  const [actions, connected, org, counts, waiting] = await Promise.all([
    listActions(s.orgId),
    listIntegrations(s.orgId),
    db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId) }),
    runCounts(s.orgId),
    waitingRuns(s.orgId),
  ]);
  const added = new Set(actions.map((a) => a.kind));
  const builtIns = Object.entries(BUILT_IN) as [keyof typeof BUILT_IN, (typeof BUILT_IN)[keyof typeof BUILT_IN]][];

  return (
    <div className="grid max-w-2xl gap-10 px-4 py-6 md:px-8 md:py-8">
      <div className="grid gap-2">
        <h1 className="page-title">AI actions</h1>
        <p className="text-muted">
          Let the AI do things for customers while it answers: refund a payment, cancel an order or subscription, or anything your own system can do, like sending a password reset.
          You decide which actions it has and when a person has to approve.
        </p>
        <ul className="grid list-disc gap-1 pl-5 text-sm text-muted">
          <li>Only for customers who emailed in, whose address is checked. Chat visitors can type any address, so the AI never acts for them.</li>
          <li>Each change is checked against the customer first: the AI can only refund or cancel what belongs to the email on the ticket.</li>
          <li>One change per reply. If it fails, the AI&apos;s reply isn&apos;t sent and the ticket comes to your team.</li>
          <li>After 50 changes in a day without a person, the rest wait for approval.</li>
          <li>Test tickets never change anything in Stripe or Shopify.</li>
        </ul>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          {error}
        </p>
      )}

      {waiting.length > 0 && (
        <section className="grid gap-3 border-t border-line pt-6">
          <h2 className="text-lg font-semibold">Waiting for approval</h2>
          <ul className="grid divide-y divide-line rounded-xl border border-line text-sm">
            {waiting.map((w) => (
              <li key={w.run.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span>
                  <Link href={`/app/tickets/${w.number}`} className="link font-medium">
                    #{w.number} {w.subject}
                  </Link>
                  <span className="block text-muted">{w.run.summary}</span>
                </span>
                <span className="text-muted">{timeAgo(w.run.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section id="records" className="grid scroll-mt-6 gap-3 border-t border-line pt-6">
        <h2 className="text-lg font-semibold">Orders and payments</h2>
        <p className="text-muted">
          With this on, the AI reads the customer&apos;s orders from Shopify and payments and plans from Stripe when it answers, so it can answer &quot;where&apos;s my order?&quot; and &quot;why was I charged?&quot; itself.
          It reads them for emailed tickets only. Actions on Stripe or Shopify always read them.
        </p>
        <p className="text-sm">
          {org?.aiReadsRecords ? "On." : "Off."}{" "}
          {!connected.shopify && !connected.stripe && (
            <>
              Needs <Link href="/app/integrations" className="link text-accent">Shopify or Stripe connected</Link>.
            </>
          )}
        </p>
        {isAdmin && (
          <form action={setReadsRecords}>
            <input type="hidden" name="on" value={org?.aiReadsRecords ? "0" : "1"} />
            <button className="btn btn-secondary btn-sm">{org?.aiReadsRecords ? "Turn off" : "Turn on"}</button>
          </form>
        )}
      </section>

      <section className="grid gap-2 border-t border-line pt-6">
        <h2 className="text-lg font-semibold">Your actions</h2>
        {actions.length === 0 ? (
          <p className="text-muted">None yet. Add one below. New actions need a person&apos;s approval until you change that.</p>
        ) : (
          <ul className="grid divide-y divide-line">
            {actions.map((a) => (
              <ActionCard key={a.id} a={a} isAdmin={isAdmin} counts={counts.get(a.id)} />
            ))}
          </ul>
        )}
      </section>

      {isAdmin ? (
        <>
          <section className="grid gap-4 border-t border-line pt-6">
            <h2 className="text-lg font-semibold">Add a ready-made action</h2>
            <ul className="grid gap-4">
              {builtIns.map(([kind, b]) => {
                const has = Boolean(connected[b.integration]);
                return (
                  <li key={kind} className="grid gap-1.5">
                    <p className="font-medium">{b.name}</p>
                    <p className="text-sm text-muted">
                      {b.describe} The {b.integration === "stripe" ? "Stripe key" : "Shopify app"} needs {b.scope}.
                    </p>
                    {added.has(kind) ? (
                      <p className="text-sm">Added.</p>
                    ) : has ? (
                      <form action={addBuiltInAction}>
                        <input type="hidden" name="kind" value={kind} />
                        <button className="btn btn-secondary btn-sm">Add</button>
                      </form>
                    ) : (
                      <p className="text-sm">
                        <Link href={`/app/integrations#${b.integration}`} className="link text-accent">
                          Connect {b.integration === "stripe" ? "Stripe" : "Shopify"} first
                        </Link>
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="grid gap-4 border-t border-line pt-6">
            <div className="grid gap-1">
              <h2 className="text-lg font-semibold">Add your own action</h2>
              <p className="text-muted">
                For anything your own system does: reset a password, change a plan, resend a licence key, look up an account. Flatdesk sends your endpoint a POST when the AI uses it.
              </p>
            </div>
            <details className="text-sm text-muted">
              <summary className="cursor-pointer font-medium text-ink">What your endpoint receives</summary>
              <pre className="num mt-2 overflow-x-auto rounded-lg bg-surface-2 p-3 text-xs">{`POST your-endpoint
X-Flatdesk-Event: ai_action
X-Flatdesk-Signature: sha256=<HMAC-SHA256 of the body, keyed with the action's secret>

{
  "event": "ai_action",
  "action": { "id": "…", "name": "Send a password reset" },
  "inputs": { "reason": "Can't sign in" },
  "customer": { "email": "sam@example.com", "name": "Sam" },
  "ticket": { "number": 1042, "subject": "…", "url": "…", "test": false },
  "run_id": "…",
  "sent_at": "2026-10-06T09:00:00.000Z"
}`}</pre>
              <p className="mt-2">
                Answer with any 2xx status to say it worked. Send <span className="num">{`{ "message": "…" }`}</span> to tell the AI what happened (a lookup&apos;s answer goes here). Anything else counts as a failure, and the ticket goes to your team.
                Each run has its own run_id, so you can ignore repeats. On test tickets, &quot;test&quot; is true.
              </p>
            </details>
            <NewWebhookActionForm />
          </section>
        </>
      ) : (
        <p className="text-sm text-muted">Only admins can add or change actions.</p>
      )}
    </div>
  );
}
