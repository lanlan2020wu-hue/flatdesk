import { asc, eq } from "drizzle-orm";
import { after } from "next/server";
import { db, schema } from "@/db";
import { SuggestionsSection } from "@/components/MacroSuggestion";
import MacroUpdates from "@/components/MacroUpdates";
import { requireOpenPage } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai";
import { access } from "@/lib/billing";
import { macroUpdates } from "@/lib/macro-drift";
import { macroSuggestions } from "@/lib/macro-suggestions";
import { withAiDrafts, withUpdateDrafts, writeMacroUpdates, writeMissingDrafts } from "@/lib/macro-writer";
import { listAgents } from "@/lib/tickets";
import { deleteMacroAction, deleteRuleAction, saveMacroAction, saveRuleAction, toggleRuleAction } from "../actions";

export const metadata = { title: "AI macros and rules" };

const field = "field";
const SOURCE_NAME: Record<string, string> = { zendesk: "Zendesk", intercom: "Intercom", freshdesk: "Freshdesk", helpscout: "Help Scout" };

export default async function MacrosPage() {
  const s = await requireOpenPage();
  const [macros, rules, agents, imported, found, drifted] = await Promise.all([
    db.select().from(schema.macros).where(eq(schema.macros.orgId, s.orgId)).orderBy(asc(schema.macros.name)),
    db.select().from(schema.rules).where(eq(schema.rules.orgId, s.orgId)).orderBy(asc(schema.rules.createdAt)),
    listAgents(s.orgId),
    db.select().from(schema.importedRules).where(eq(schema.importedRules.orgId, s.orgId)).orderBy(asc(schema.importedRules.name)),
    macroSuggestions(s.orgId),
    macroUpdates(s.orgId),
  ]);
  // Behind the paywall the page still renders, so it must not start paid AI calls.
  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId) });
  const open = !org || access(org).state !== "locked";
  // The AI writes up the repeats it hasn't written yet, after this page is sent.
  const { suggestions, missing } = await withAiDrafts(s.orgId, found);
  if (open && missing.length) after(() => writeMissingDrafts(s.orgId, missing));
  // Macros the team keeps editing the same way, rewritten by the AI.
  const { updates, missing: unwritten } = await withUpdateDrafts(s.orgId, drifted);
  if (open && unwritten.length) after(() => writeMacroUpdates(s.orgId, unwritten));
  // Imported rules that aren't running as a Flatdesk rule: shown for reference.
  const reference = imported.filter((r) => !r.flatdeskRuleId);
  const agentName = (id: string) => agents.find((a) => a.userId === id)?.name ?? "Removed agent";
  const team = agents.filter((a) => !a.viewer).map((a) => ({ userId: a.userId, name: a.name }));
  // What a macro does besides insert its reply, in words, for its row.
  const doesAlso = (m: (typeof macros)[number]) =>
    [
      m.assignTo && `assigns to ${agentName(m.assignTo)}`,
      m.setStatus && `sets ${m.setStatus}`,
      m.addTags.length > 0 && `tags ${m.addTags.join(", ")}`,
      m.sendNow && "sends right away",
    ].filter(Boolean) as string[];

  return (
    <div className="grid max-w-3xl gap-12 px-4 py-6 md:px-8 md:py-8">
      <section className="grid gap-4">
        <div className="grid gap-1">
          <h1 className="page-title">AI macros</h1>
          <p className="text-sm text-muted">
            Flatdesk finds the answers your team keeps retyping and the AI writes them up as macros. New tickets get the right macro offered in the reply box. A macro can also assign, set the status, add tags and send right away. When your team keeps editing a macro the same way, the AI drafts an update you apply in one click.
          </p>
        </div>

        <MacroUpdates updates={updates} aiOn={aiConfigured()} canApply={s.role === "admin"} />

        <SuggestionsSection suggestions={suggestions} aiOn={aiConfigured()} />

        {/* Saved macros as one ruled list; each row opens to edit. */}
        {macros.length > 0 && (
        <div className="card divide-y divide-line overflow-hidden">
        {macros.map((m) => (
          <details key={m.id}>
            <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-4 font-medium transition-colors hover:bg-surface-2/60">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{m.name}</span>
                {m.source === "suggested" ? (
                  <span className="chip shrink-0">Written by Flatdesk AI</span>
                ) : (
                  m.source && <span className="chip shrink-0">From {SOURCE_NAME[m.source] ?? m.source}</span>
                )}
                {m.notApplied.length > 0 && <span className="pill shrink-0 bg-warn/15 text-xs font-normal text-warn">{m.notApplied.length} not applied</span>}
                {doesAlso(m).length > 0 && <span className="hidden truncate text-xs font-normal text-muted sm:inline">{doesAlso(m).join(" · ")}</span>}
              </span>
              <svg viewBox="0 0 20 20" className="chevron size-4 shrink-0 text-muted transition-transform" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 8l5 5 5-5" /></svg>
            </summary>
            {m.notApplied.length > 0 && (
              <div className="mx-5 mt-1 rounded-lg bg-warn-soft px-4 py-3 text-sm">
                <p className="font-medium">The original macro also did this, which Flatdesk can&apos;t do yet:</p>
                <ul className="mt-1 list-disc pl-5 text-muted">
                  {m.notApplied.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
            {m.question && <p className="mx-5 mt-1 text-sm text-muted">Offered on tickets that ask: <span className="text-ink">{m.question}</span></p>}
            <MacroForm macro={m} agents={team} />
            <form action={deleteMacroAction} className="px-5 pb-5">
              <input type="hidden" name="id" value={m.id} />
              <button className="link text-sm text-warn">Delete macro</button>
            </form>
          </details>
        ))}
        </div>
        )}

        <details className="grid gap-3">
          <summary className="btn btn-secondary w-max cursor-pointer list-none">New macro</summary>
          <div className="card mt-3">
            <MacroForm agents={team} />
          </div>
        </details>
      </section>

      <section className="grid gap-4 border-t border-line pt-4">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">Assignment rules</h2>
          <p className="text-sm text-muted">When an unassigned ticket gets a tag, assign it to someone. The oldest matching rule wins.{s.role !== "admin" && " Only admins can change rules."}</p>
        </div>

        {rules.length > 0 && (
          <ul className="card divide-y divide-line overflow-hidden">
            {rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-sm">
                <span className={r.enabled ? "" : "text-muted line-through"}>
                  If tagged <strong>{r.ifTag}</strong>, assign to <strong>{agentName(r.assignTo)}</strong>
                </span>
                {s.role === "admin" && (
                  <span className="flex gap-3">
                    <form action={toggleRuleAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="enabled" value={String(!r.enabled)} />
                      <button className="link">{r.enabled ? "Turn off" : "Turn on"}</button>
                    </form>
                    <form action={deleteRuleAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="link text-warn">Delete</button>
                    </form>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {s.role === "admin" && (
          <form action={saveRuleAction} className="flex flex-wrap items-end gap-3 text-sm">
            <label className="grid gap-1.5 font-medium" htmlFor="ifTag">If tagged<input id="ifTag" name="ifTag" required placeholder="billing" className={`${field} font-normal`} /></label>
            <label className="grid gap-1.5 font-medium" htmlFor="assignTo">assign to
              <select id="assignTo" name="assignTo" required className={`${field} font-normal`}>
                {team.map((a) => <option key={a.userId} value={a.userId}>{a.name}</option>)}
              </select>
            </label>
            <button className="btn btn-primary">Add rule</button>
          </form>
        )}

        {reference.length > 0 && (
          <div className="grid gap-2 pt-2">
            <h3 className="eyebrow">Kept from your old help desk</h3>
            <p className="text-sm text-muted">
              These rules were imported for reference and aren&apos;t running. Flatdesk rules assign by tag; recreate the ones you still need above.
            </p>
            <ul className="card divide-y divide-line overflow-hidden">
              {reference.map((r) => (
                <li key={r.id}>
                  <details className="px-5 py-3 text-sm">
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{r.name}</span>
                      <span className="flex items-center gap-2 text-xs text-muted">
                        {r.pendingAssigneeEmail && <span className="pill text-accent">Starts when {r.pendingAssigneeEmail} joins</span>}
                        <span className="chip">
                          {SOURCE_NAME[r.source]} {r.kind}
                          {!r.activeInSource && ", was off"}
                        </span>
                      </span>
                    </summary>
                    <ul className="mt-2 grid gap-1 text-muted">
                      {r.summary.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

function MacroForm({ macro, agents }: { macro?: typeof schema.macros.$inferSelect; agents: { userId: string; name: string }[] }) {
  const key = macro?.id ?? "new";
  return (
    <form action={saveMacroAction} className="grid gap-4 p-5 text-sm">
      {macro && <input type="hidden" name="id" value={macro.id} />}
      <label className="grid gap-1.5 font-medium" htmlFor={`name-${key}`}>Name<input id={`name-${key}`} name="name" required defaultValue={macro?.name} className={`${field} font-normal`} /></label>
      <label className="grid gap-1.5 font-medium" htmlFor={`body-${key}`}>Reply<textarea id={`body-${key}`} name="body" required rows={4} defaultValue={macro?.body} className={`${field} font-normal`} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 font-medium" htmlFor={`tags-${key}`}>Add tags<input id={`tags-${key}`} name="addTags" defaultValue={macro?.addTags.join(", ")} placeholder="refund" className={`${field} font-normal`} /></label>
        <label className="grid gap-1.5 font-medium" htmlFor={`status-${key}`}>Set status
          <select id={`status-${key}`} name="setStatus" defaultValue={macro?.setStatus ?? ""} className={`${field} font-normal`}>
            <option value="">Leave as is</option>
            <option value="open">Open</option>
            <option value="pending">Pending</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        <label className="grid gap-1.5 font-medium" htmlFor={`assign-${key}`}>Assign to
          <select id={`assign-${key}`} name="assignTo" defaultValue={macro?.assignTo ?? ""} className={`${field} font-normal`}>
            <option value="">Leave as is</option>
            {agents.map((a) => <option key={a.userId} value={a.userId}>{a.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-2 font-medium" htmlFor={`send-${key}`}>
          <input id={`send-${key}`} type="checkbox" name="sendNow" defaultChecked={macro?.sendNow} className="size-4 accent-[var(--accent)]" />
          Send the reply as soon as it&apos;s used
        </label>
      </div>
      <p className="text-xs text-muted">[customer name] is filled in for you. A macro set to send right away waits if it still has other blanks, like [order number].</p>
      <button className="btn btn-primary w-max">{macro ? "Save macro" : "Add macro"}</button>
    </form>
  );
}
