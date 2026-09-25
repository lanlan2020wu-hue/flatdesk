import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { listAgents } from "@/lib/tickets";
import { deleteMacroAction, deleteRuleAction, saveMacroAction, saveRuleAction, toggleRuleAction } from "../actions";

export const metadata = { title: "Macros and rules" };

const field = "rounded-md border border-line bg-surface px-3 py-2";

export default async function MacrosPage() {
  const s = await requireSession();
  const [macros, rules, agents] = await Promise.all([
    db.select().from(schema.macros).where(eq(schema.macros.orgId, s.orgId)).orderBy(asc(schema.macros.name)),
    db.select().from(schema.rules).where(eq(schema.rules.orgId, s.orgId)).orderBy(asc(schema.rules.createdAt)),
    listAgents(s.orgId),
  ]);
  const agentName = (id: string) => agents.find((a) => a.userId === id)?.name ?? "Removed agent";

  return (
    <div className="grid max-w-3xl gap-10 px-4 py-6 md:px-8">
      <section className="grid gap-4">
        <div className="grid gap-1">
          <h1 className="font-display text-2xl">Macros</h1>
          <p className="text-sm text-muted">Saved replies your team can insert into any ticket. A macro can also add tags and set the status.</p>
        </div>

        {macros.map((m) => (
          <details key={m.id} className="rounded-lg border border-line bg-surface">
            <summary className="cursor-pointer px-4 py-3 font-medium">{m.name}</summary>
            <MacroForm macro={m} />
            <form action={deleteMacroAction} className="px-4 pb-4">
              <input type="hidden" name="id" value={m.id} />
              <button className="text-sm text-warn underline">Delete macro</button>
            </form>
          </details>
        ))}

        <div className="rounded-lg border border-dashed border-line">
          <p className="px-4 pt-3 font-medium">New macro</p>
          <MacroForm />
        </div>
      </section>

      <section className="grid gap-4">
        <div className="grid gap-1">
          <h2 className="font-display text-2xl">Assignment rules</h2>
          <p className="text-sm text-muted">When an unassigned ticket gets a tag, assign it to someone. The oldest matching rule wins.{s.role !== "admin" && " Only admins can change rules."}</p>
        </div>

        {rules.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className={r.enabled ? "" : "text-muted line-through"}>
                  If tagged <strong>{r.ifTag}</strong>, assign to <strong>{agentName(r.assignTo)}</strong>
                </span>
                {s.role === "admin" && (
                  <span className="flex gap-3">
                    <form action={toggleRuleAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="enabled" value={String(!r.enabled)} />
                      <button className="underline">{r.enabled ? "Turn off" : "Turn on"}</button>
                    </form>
                    <form action={deleteRuleAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="text-warn underline">Delete</button>
                    </form>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {s.role === "admin" && (
          <form action={saveRuleAction} className="flex flex-wrap items-end gap-3 text-sm">
            <label className="grid gap-1" htmlFor="ifTag">If tagged<input id="ifTag" name="ifTag" required placeholder="billing" className={field} /></label>
            <label className="grid gap-1" htmlFor="assignTo">assign to
              <select id="assignTo" name="assignTo" required className={field}>
                {agents.map((a) => <option key={a.userId} value={a.userId}>{a.name}</option>)}
              </select>
            </label>
            <button className="rounded-md bg-accent px-4 py-2 font-medium text-accent-ink">Add rule</button>
          </form>
        )}
      </section>
    </div>
  );
}

function MacroForm({ macro }: { macro?: typeof schema.macros.$inferSelect }) {
  const key = macro?.id ?? "new";
  return (
    <form action={saveMacroAction} className="grid gap-3 p-4 text-sm">
      {macro && <input type="hidden" name="id" value={macro.id} />}
      <label className="grid gap-1" htmlFor={`name-${key}`}>Name<input id={`name-${key}`} name="name" required defaultValue={macro?.name} className={field} /></label>
      <label className="grid gap-1" htmlFor={`body-${key}`}>Reply<textarea id={`body-${key}`} name="body" required rows={4} defaultValue={macro?.body} className={field} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1" htmlFor={`tags-${key}`}>Add tags<input id={`tags-${key}`} name="addTags" defaultValue={macro?.addTags.join(", ")} placeholder="refund" className={field} /></label>
        <label className="grid gap-1" htmlFor={`status-${key}`}>Set status
          <select id={`status-${key}`} name="setStatus" defaultValue={macro?.setStatus ?? ""} className={field}>
            <option value="">Leave as is</option>
            <option value="open">Open</option>
            <option value="pending">Pending</option>
            <option value="closed">Closed</option>
          </select>
        </label>
      </div>
      <button className="w-max rounded-md bg-accent px-4 py-2 font-medium text-accent-ink">{macro ? "Save macro" : "Add macro"}</button>
    </form>
  );
}
