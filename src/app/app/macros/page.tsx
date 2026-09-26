import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { listAgents } from "@/lib/tickets";
import { deleteMacroAction, deleteRuleAction, saveMacroAction, saveRuleAction, toggleRuleAction } from "../actions";

export const metadata = { title: "Macros and rules" };

const field = "field";
const SOURCE_NAME: Record<string, string> = { zendesk: "Zendesk", intercom: "Intercom", freshdesk: "Freshdesk", helpscout: "Help Scout" };

export default async function MacrosPage() {
  const s = await requireSession();
  const [macros, rules, agents, imported] = await Promise.all([
    db.select().from(schema.macros).where(eq(schema.macros.orgId, s.orgId)).orderBy(asc(schema.macros.name)),
    db.select().from(schema.rules).where(eq(schema.rules.orgId, s.orgId)).orderBy(asc(schema.rules.createdAt)),
    listAgents(s.orgId),
    db.select().from(schema.importedRules).where(eq(schema.importedRules.orgId, s.orgId)).orderBy(asc(schema.importedRules.name)),
  ]);
  // Imported rules that aren't running as a Flatdesk rule: shown for reference.
  const reference = imported.filter((r) => !r.flatdeskRuleId);
  const agentName = (id: string) => agents.find((a) => a.userId === id)?.name ?? "Removed agent";

  return (
    <div className="grid max-w-3xl gap-12 px-4 py-6 md:px-8 md:py-8">
      <section className="grid gap-4">
        <div className="grid gap-1">
          <h1 className="font-display text-3xl">Macros</h1>
          <p className="text-sm text-muted">Saved replies your team can insert into any ticket. A macro can also add tags and set the status.</p>
        </div>

        {macros.map((m) => (
          <details key={m.id} className="card overflow-hidden">
            <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-4 font-medium transition-colors hover:bg-surface-2/60">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{m.name}</span>
                {m.source && <span className="chip shrink-0">From {SOURCE_NAME[m.source] ?? m.source}</span>}
                {m.notApplied.length > 0 && <span className="pill shrink-0 bg-warn/15 text-xs font-normal text-warn">{m.notApplied.length} not applied</span>}
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
            <MacroForm macro={m} />
            <form action={deleteMacroAction} className="px-5 pb-5">
              <input type="hidden" name="id" value={m.id} />
              <button className="link text-sm text-warn">Delete macro</button>
            </form>
          </details>
        ))}

        <div className="rounded-2xl border border-dashed border-line-strong">
          <p className="px-5 pt-4 font-medium">New macro</p>
          <MacroForm />
        </div>
      </section>

      <section className="grid gap-4">
        <div className="grid gap-1">
          <h2 className="font-display text-3xl">Assignment rules</h2>
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
          <form action={saveRuleAction} className="card flex flex-wrap items-end gap-3 p-5 text-sm">
            <label className="grid gap-1.5 font-medium" htmlFor="ifTag">If tagged<input id="ifTag" name="ifTag" required placeholder="billing" className={`${field} font-normal`} /></label>
            <label className="grid gap-1.5 font-medium" htmlFor="assignTo">assign to
              <select id="assignTo" name="assignTo" required className={`${field} font-normal`}>
                {agents.map((a) => <option key={a.userId} value={a.userId}>{a.name}</option>)}
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

function MacroForm({ macro }: { macro?: typeof schema.macros.$inferSelect }) {
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
      </div>
      <button className="btn btn-primary w-max">{macro ? "Save macro" : "Add macro"}</button>
    </form>
  );
}
