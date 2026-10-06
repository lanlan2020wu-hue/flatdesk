import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireOpenPage } from "@/lib/auth";
import { AUTO_CLOSE_CHOICES, autoCloseTriggers, listGroups } from "@/lib/routing";
import { listAgents } from "@/lib/tickets";
import { addAutoCloseAction, deleteGroupAction, saveGroupAction, saveRoutingAction, setAwayAction } from "./server";

export const metadata = { title: "Groups and routing" };

function GroupForm({ group, people, isAdmin }: { group?: Awaited<ReturnType<typeof listGroups>>[number]; people: { userId: string; name: string }[]; isAdmin: boolean }) {
  const key = group?.id ?? "new";
  return (
    <form action={saveGroupAction} className="grid gap-3">
      {group && <input type="hidden" name="id" value={group.id} />}
      <fieldset disabled={!isAdmin} className="grid gap-3">
        <label className="grid gap-1.5" htmlFor={`gname-${key}`}>
          <span className="label">Name</span>
          <input id={`gname-${key}`} name="name" required maxLength={60} defaultValue={group?.name} placeholder="Billing" className="field max-w-xs text-sm" />
        </label>
        <fieldset className="grid gap-1.5">
          <legend className="label mb-1">People in it</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {people.map((p) => (
              <label key={p.userId} className="flex items-center gap-2">
                <input type="checkbox" name="members" value={p.userId} defaultChecked={group?.members.includes(p.userId)} className="size-4 accent-[var(--accent)]" />
                {p.name}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" name="shareInTurn" defaultChecked={group?.shareInTurn} className="mt-1 size-4 accent-[var(--accent)]" />
          <span>
            Share its tickets in turn
            <span className="block text-muted">Each ticket sent to this group goes to the next person in it, skipping anyone away.</span>
          </span>
        </label>
        {isAdmin && <button className="btn btn-secondary btn-sm w-max">{group ? "Save group" : "Add group"}</button>}
      </fieldset>
    </form>
  );
}

export default async function RoutingPage({ searchParams }: PageProps<"/app/routing">) {
  const s = await requireOpenPage();
  const { error } = await searchParams;
  const [org, groups, team, closers] = await Promise.all([
    db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId) }),
    listGroups(s.orgId),
    listAgents(s.orgId),
    autoCloseTriggers(s.orgId),
  ]);
  const isAdmin = s.role === "admin";
  const people = team.filter((a) => !a.viewer);
  const nameOf = (id: string) => people.find((p) => p.userId === id)?.name;

  return (
    <div className="grid max-w-2xl gap-10 px-4 py-6 md:px-8 md:py-8">
      <div className="grid gap-2">
        <h1 className="page-title">Groups and routing</h1>
        <p className="text-muted">
          Who gets which tickets. Tickets the AI answers stay with the AI; these only decide who gets a ticket once it needs a person.
        </p>
        {error && <p className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-sm text-warn" role="alert">{error}</p>}
      </div>

      <section id="team" className="grid scroll-mt-6 gap-4 border-t border-line pt-6">
        <h2 className="text-lg font-semibold">The whole team</h2>
        <form action={saveRoutingAction} className="grid gap-4">
          <fieldset disabled={!isAdmin} className="grid gap-4">
            <label className="flex items-start gap-2.5">
              <input type="checkbox" name="shareInTurn" defaultChecked={org?.shareInTurn} className="mt-1 size-4 accent-[var(--accent)]" />
              <span>
                Share new tickets in turn
                <span className="block text-sm text-muted">
                  A new ticket that no trigger or rule gave to someone goes to the next person, skipping anyone away. The person who waited longest
                  gets the next one. Tickets in a group follow the group&apos;s setting instead.
                </span>
              </span>
            </label>
            {isAdmin && <button className="btn btn-primary w-max">Save</button>}
          </fieldset>
          {!isAdmin && <p className="text-sm text-muted">Only admins can change these.</p>}
        </form>
      </section>

      <section id="auto-close" className="grid scroll-mt-6 gap-3 border-t border-line pt-6">
        <h2 className="text-lg font-semibold">Closing quiet tickets</h2>
        <p className="text-muted">
          A pending ticket waits on the customer. A timed trigger can close it when nothing has happened for a while, with a note. If the customer writes
          back, it opens again.
        </p>
        {closers.length > 0 ? (
          <ul className="grid gap-1 text-sm">
            {closers.map((t) => (
              <li key={t.id}>
                {t.name}
                {!t.enabled && <span className="chip ml-2">Off</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nothing closes quiet tickets yet.</p>
        )}
        {isAdmin && closers.length === 0 && (
          <form action={addAutoCloseAction} className="flex flex-wrap items-center gap-2 text-sm">
            <span>Close pending tickets after</span>
            <select name="days" defaultValue="7" className="field field-sm w-auto" aria-label="Days">
              {AUTO_CLOSE_CHOICES.map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
            <button className="btn btn-secondary btn-sm">Add trigger</button>
          </form>
        )}
        <p className="text-sm text-muted">
          Change or remove it with the other triggers on the <Link href="/app/macros#triggers" className="link text-accent">AI macros page</Link>.
        </p>
      </section>

      <section id="people" className="grid scroll-mt-6 gap-3 border-t border-line pt-6">
        <h2 className="text-lg font-semibold">Who&apos;s away</h2>
        <p className="text-muted">Away people keep their tickets but aren&apos;t given new ones in turn. Mark yourself away for a day off{isAdmin ? ", or anyone on the team" : ""}.</p>
        <ul className="grid divide-y divide-line border-y border-line">
          {people.map((p) => {
            const canChange = isAdmin || p.userId === s.userId;
            return (
              <li key={p.userId} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span>
                  {p.name}
                  {p.userId === s.userId && <span className="text-muted"> (you)</span>}
                  {p.away && <span className="chip ml-2 border-warn/40 bg-warn-soft text-warn">Away</span>}
                </span>
                {canChange && (
                  <form action={setAwayAction}>
                    <input type="hidden" name="userId" value={p.userId} />
                    <input type="hidden" name="away" value={String(!p.away)} />
                    <button className="btn btn-secondary btn-sm">{p.away ? "Back" : "Mark away"}</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section id="groups" className="grid scroll-mt-6 gap-4 border-t border-line pt-6">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">Groups</h2>
          <p className="text-muted">
            Groups like Billing or Tier 2. Put a ticket in one from the ticket, the inbox, or a trigger (&quot;Send to group&quot; on the AI macros page). Everyone
            in a group sees its open tickets under My groups in the inbox.
          </p>
        </div>
        {groups.length > 0 && (
          <ul className="grid divide-y divide-line border-y border-line">
            {groups.map((g) => (
              <li key={g.id} id={`group-${g.id}`} className="grid scroll-mt-6 gap-3 py-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold">
                    {g.name} {g.shareInTurn && <span className="chip ml-1">Shared in turn</span>}
                  </h3>
                  <span className="text-sm text-muted">{g.members.map(nameOf).filter(Boolean).join(", ") || "Nobody in it yet"}</span>
                </div>
                {isAdmin && (
                  <details>
                    <summary className="link w-max cursor-pointer text-sm text-accent">Edit</summary>
                    <div className="grid gap-3 pt-3">
                      <GroupForm group={g} people={people} isAdmin={isAdmin} />
                      <form action={deleteGroupAction}>
                        <input type="hidden" name="id" value={g.id} />
                        <button className="link text-sm text-warn">Delete group (its tickets keep their place, with no group)</button>
                      </form>
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
        {isAdmin ? (
          <div id="new-group" className="grid scroll-mt-6 gap-3 rounded-xl border border-line px-4 py-4">
            <h3 className="font-semibold">New group</h3>
            <GroupForm people={people} isAdmin={isAdmin} />
          </div>
        ) : (
          groups.length === 0 && <p className="text-sm text-muted">No groups yet. An admin can add them here.</p>
        )}
      </section>
    </div>
  );
}
