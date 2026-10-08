import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { after } from "next/server";
import { db, schema } from "@/db";
import HowItWorks from "@/components/HowItWorks";
import TagInput from "@/components/TagInput";
import { SuggestionsSection } from "@/components/MacroSuggestion";
import MacroUpdates from "@/components/MacroUpdates";
import { requireOpenPage } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai";
import { access } from "@/lib/billing";
import { macroUpdates } from "@/lib/macro-drift";
import { LEARN, LEARNED_SOURCE, recentLearning } from "@/lib/learn";
import { macroSuggestions } from "@/lib/macro-suggestions";
import { withAiDrafts, withUpdateDrafts, writeMacroUpdates, writeMissingDrafts } from "@/lib/macro-writer";
import { listGroups } from "@/lib/routing";
import { listAgents, orgTags } from "@/lib/tickets";
import { CONDITION_FIELDS, describeAction, describeCondition, EVENTS, FORM_ROWS, MAX_HOURS } from "@/lib/triggers";
import { deleteMacroAction, deleteRuleAction, saveMacroAction, saveRuleAction, toggleRuleAction } from "../actions";
import { deleteTriggerAction, moveTriggerUpAction, saveTriggerAction, toggleTriggerAction } from "./trigger-actions";

export const metadata = { title: "AI macros and rules" };

const field = "field";
const SOURCE_NAME: Record<string, string> = { zendesk: "Zendesk", intercom: "Intercom", freshdesk: "Freshdesk", helpscout: "Help Scout" };

export default async function MacrosPage({ searchParams }: { searchParams: Promise<{ trigger?: string }> }) {
  const s = await requireOpenPage();
  const triggerError = (await searchParams).trigger;
  const [macros, rules, triggerList, agents, imported, found, drifted, tags, groupList, learned] = await Promise.all([
    db.select().from(schema.macros).where(eq(schema.macros.orgId, s.orgId)).orderBy(asc(schema.macros.name)),
    db.select().from(schema.rules).where(eq(schema.rules.orgId, s.orgId)).orderBy(asc(schema.rules.createdAt)),
    db.select().from(schema.triggers).where(eq(schema.triggers.orgId, s.orgId)).orderBy(asc(schema.triggers.position), asc(schema.triggers.createdAt)),
    listAgents(s.orgId),
    db.select().from(schema.importedRules).where(eq(schema.importedRules.orgId, s.orgId)).orderBy(asc(schema.importedRules.name)),
    macroSuggestions(s.orgId),
    macroUpdates(s.orgId),
    orgTags(s.orgId),
    listGroups(s.orgId),
    recentLearning(s.orgId),
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
  const reference = imported.filter((r) => !r.flatdeskRuleId && !r.flatdeskTriggerId);
  const agentName = (id: string) => agents.find((a) => a.userId === id)?.name ?? "Removed agent";
  const groupName = (id: string) => groupList.find((g) => g.id === id)?.name ?? "a deleted group";
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
          <p className="text-muted">
            A macro is a saved reply. Anyone on your team inserts it with one click instead of typing the answer again. Flatdesk makes macros for you from the replies your team already sends.
          </p>
        </div>

        <HowItWorks
          title="How AI macros work"
          open={macros.length === 0}
          summary="Nothing here needs setting up. It runs on the replies your team sends to customers."
          steps={[
            { title: "Your team answers tickets as usual", body: "Flatdesk reads the replies your team sent in the last 90 days, including tickets imported from your old help desk." },
            { title: "Flatdesk spots repeats", body: "When roughly the same reply has gone out on 5 different tickets, it shows up on this page as a suggested macro." },
            { title: "The AI writes it up", body: "It turns your team's versions into one clean reply with blanks like [customer name] or [order number], and notes which customer question it answers." },
            { title: "You check it and save it", body: "Edit anything you like, then click Save as macro. Nothing is offered to anyone until it's saved." },
            { title: "It's offered on new tickets", body: "When a customer asks the same thing, the reply box on the ticket shows the macro with a Use macro button. One click fills it in. The AI also uses saved macros when it answers customers on its own." },
            { title: "It keeps up with changes", body: "If your team keeps making the same edit before sending it (on most of the last 3 or more sends), the AI drafts an updated macro here. An admin applies it or keeps the old one." },
            { title: "The AI learns on its own", body: `Once a day the AI reads tickets your team solved, starting with the ones it handed over. When your team answered something no saved answer covers, it saves the answer. When your reply shows a learned answer changed, it updates it, and it retires learned answers nobody used in ${LEARN.staleDays} days. Your own macros are never changed; if one looks out of date, it's flagged here.` },
          ]}
          example={
            <>
              customers keep asking where their order is. Over a week, Sam, Priya and Lee each type a similar answer on 5 tickets. Flatdesk suggests a
              &quot;Where is my order&quot; macro with [order number] as a blank. The next time a customer asks, the reply box offers it.
            </>
          }
          footnote="A macro can also assign the ticket, set its status, add tags or send right away. Set these when you edit it. Writing and updating macros is included in your plan and doesn't use your AI answers."
        />

        <MacroUpdates updates={updates} aiOn={aiConfigured() && Boolean(org?.aiProcessing)} canApply={s.role === "admin"} />

        {learned.length > 0 && <LearnedLog rows={learned} />}

        <SuggestionsSection suggestions={suggestions} aiOn={aiConfigured() && Boolean(org?.aiProcessing)} tags={tags} />

        {/* Saved macros as one ruled list; each row opens to edit. */}
        {macros.length > 0 && (
        <div className="card divide-y divide-line overflow-hidden">
        {macros.map((m) => (
          <details key={m.id}>
            <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-4 font-medium transition-colors hover:bg-surface-2/60">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{m.name}</span>
                {m.source === LEARNED_SOURCE ? (
                  <span className="chip shrink-0">Learned by the AI</span>
                ) : m.source === "suggested" ? (
                  <span className="chip shrink-0">Written by Flatdesk AI</span>
                ) : m.source === "taught" ? (
                  <span className="chip shrink-0">Taught from a ticket</span>
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
            <MacroForm macro={m} agents={team} tags={tags} />
            <form action={deleteMacroAction} className="px-5 pb-5">
              <input type="hidden" name="id" value={m.id} />
              <button className="link text-sm text-warn">Delete macro</button>
            </form>
          </details>
        ))}
        </div>
        )}

        {macros.length === 0 && suggestions.length === 0 && updates.length === 0 && (
          <div className="card grid gap-2 p-5 text-sm">
            <p className="font-medium">No macros yet</p>
            <p className="text-muted">
              Suggestions show up here once your team has sent the same reply on 5 tickets. Importing from your old help desk brings its macros and past replies, so
              suggestions can start today. You can also write one yourself.
            </p>
            {s.role === "admin" && <Link href="/app/import" className="link w-max font-medium text-accent">Import from your old help desk</Link>}
          </div>
        )}

        <details className="grid gap-3">
          <summary className="btn btn-secondary w-max cursor-pointer list-none">Write a macro yourself</summary>
          <div className="card mt-3">
            <MacroForm agents={team} tags={tags} />
          </div>
        </details>
      </section>

      <section id="triggers" className="grid scroll-mt-6 gap-4 border-t border-line pt-4">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">Triggers</h2>
          <p className="text-sm text-muted">
            A trigger runs when a new ticket arrives, when the customer writes back, or once a ticket has gone a number of hours without an update (like Zendesk automations: &quot;pending for 3 days, email the customer, then close it&quot;). It can tag, assign, set the status and leave a note; timed ones can also email the customer. They run top to bottom, so tags one adds can match the next, and the ticket gets a note saying which ran. Imported Zendesk triggers and automations that fit show up here.{s.role !== "admin" && " Only admins can change triggers."}
          </p>
        </div>
        {triggerError && <p className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-sm text-warn" role="alert">{triggerError}</p>}

        {triggerList.length > 0 && (
          <ol className="card divide-y divide-line overflow-hidden">
            {triggerList.map((t, i) => (
              <li key={t.id} className="grid gap-2 px-5 py-3.5 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className={`font-medium ${t.enabled ? "" : "text-muted line-through"}`}>{i + 1}. {t.name}</span>
                  {s.role === "admin" && (
                    <span className="flex gap-3">
                      {i > 0 && (
                        <form action={moveTriggerUpAction}>
                          <input type="hidden" name="id" value={t.id} />
                          <button className="link">Move up</button>
                        </form>
                      )}
                      <form action={toggleTriggerAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="enabled" value={String(!t.enabled)} />
                        <button className="link">{t.enabled ? "Turn off" : "Turn on"}</button>
                      </form>
                      <form action={deleteTriggerAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <button className="link text-warn">Delete</button>
                      </form>
                    </span>
                  )}
                </div>
                <p className="text-muted">
                  When {t.event === "timed" ? `a ticket has had no update for ${t.hours} hours` : EVENTS.find((e) => e.id === t.event)?.label} and {t.matchAll ? "all" : "any"} of: {t.conditions.map(describeCondition).join("; ")}. Then {t.actions.map((a) => describeAction(a, agentName, groupName)).join(", ")}.
                </p>
                {s.role === "admin" && (
                  <details>
                    <summary className="link w-max cursor-pointer list-none">Edit</summary>
                    <div className="card mt-3">
                      <TriggerForm trigger={t} agents={team} tags={tags} groups={groupList} />
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}

        {s.role === "admin" && (
          <details className="grid gap-3" open={triggerList.length === 0 && Boolean(triggerError)}>
            <summary className="btn btn-secondary w-max cursor-pointer list-none">Add a trigger</summary>
            <div className="card mt-3">
              <TriggerForm agents={team} tags={tags} groups={groupList} />
            </div>
          </details>
        )}
      </section>

      <section className="grid gap-4 border-t border-line pt-4">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">Assignment rules</h2>
          <p className="text-sm text-muted">Pick who gets a ticket from its tags. For example, &quot;if tagged billing, assign to Sam&quot; sends every unassigned billing ticket to Sam. Tags come from a person, a macro or your old help desk. If two rules match, the older one wins.{s.role !== "admin" && " Only admins can change rules."}</p>
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
            <label className="grid gap-1.5 font-medium" htmlFor="ifTag">If tagged<TagInput tags={tags} multiple={false} id="ifTag" name="ifTag" required placeholder="billing" className={`${field} font-normal`} /></label>
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
              These rules were imported for reference and aren&apos;t running, because they do something Flatdesk triggers can&apos;t (like send an email or set a custom field). Recreate the parts you still need as triggers above.
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

function MacroForm({ macro, agents, tags }: { macro?: typeof schema.macros.$inferSelect; agents: { userId: string; name: string }[]; tags: string[] }) {
  const key = macro?.id ?? "new";
  return (
    <form action={saveMacroAction} className="grid gap-4 p-5 text-sm">
      {macro && <input type="hidden" name="id" value={macro.id} />}
      <label className="grid gap-1.5 font-medium" htmlFor={`name-${key}`}>Name<input id={`name-${key}`} name="name" required defaultValue={macro?.name} className={`${field} font-normal`} /></label>
      <label className="grid gap-1.5 font-medium" htmlFor={`body-${key}`}>Reply<textarea id={`body-${key}`} name="body" required rows={4} defaultValue={macro?.body} className={`${field} font-normal`} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 font-medium" htmlFor={`tags-${key}`}>Add tags<TagInput tags={tags} id={`tags-${key}`} name="addTags" defaultValue={macro?.addTags.join(", ")} placeholder="refund" className={`${field} font-normal`} /></label>
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

function TriggerForm({ trigger, agents, tags, groups }: { trigger?: typeof schema.triggers.$inferSelect; agents: { userId: string; name: string }[]; tags: string[]; groups: { id: string; name: string }[] }) {
  const key = trigger?.id ?? "new";
  const act = <T extends string>(type: T) => trigger?.actions.find((a) => a.type === type);
  const tagAct = act("add_tags");
  const assignAct = act("assign");
  const groupAct = act("group");
  const statusAct = act("set_status");
  const noteAct = act("note");
  const replyAct = act("reply");
  const rows = Array.from({ length: FORM_ROWS }, (_, i) => trigger?.conditions[i]);
  return (
    <form action={saveTriggerAction} className="grid gap-4 p-5 text-sm">
      {trigger && <input type="hidden" name="id" value={trigger.id} />}
      <label className="grid gap-1.5 font-medium" htmlFor={`tname-${key}`}>Name<input id={`tname-${key}`} name="name" required maxLength={120} defaultValue={trigger?.name} placeholder="Refunds to billing" className={`${field} font-normal`} /></label>
      <div className="flex flex-wrap items-center gap-2 font-medium">
        Run when
        <select name="event" defaultValue={trigger?.event ?? "created"} className={`${field} field-sm font-normal`} aria-label="When it runs">
          {EVENTS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
        </select>
        <input name="hours" type="number" min={1} max={MAX_HOURS} defaultValue={trigger?.hours ?? 72} className={`${field} field-sm w-20 font-normal`} aria-label="Hours without an update (timed triggers)" />
        <span className="font-normal text-muted">hours (timed only)</span>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 flex flex-wrap items-center gap-2 font-medium">
          and the ticket matches
          <select name="match" defaultValue={trigger && !trigger.matchAll ? "any" : "all"} className={`${field} field-sm font-normal`} aria-label="All or any">
            <option value="all">all</option>
            <option value="any">any</option>
          </select>
          of these
        </legend>
        {rows.map((c, i) => (
          <div key={i} className="flex flex-wrap gap-2">
            <select name={`c${i}_field`} defaultValue={c?.field ?? "subject_or_body"} className={`${field} field-sm`} aria-label={`Condition ${i + 1} field`}>
              {CONDITION_FIELDS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            <select name={`c${i}_op`} defaultValue={c && (c.op === "excludes" || c.op === "is_not") ? "excludes" : "includes"} className={`${field} field-sm`} aria-label={`Condition ${i + 1} test`}>
              <option value="includes">has any of</option>
              <option value="excludes">has none of</option>
            </select>
            <input name={`c${i}_value`} defaultValue={c?.value} placeholder={i === 0 ? "refund, money back" : ""} className={`${field} field-sm min-w-48 flex-1`} aria-label={`Condition ${i + 1} words`} />
          </div>
        ))}
        <p className="text-xs text-muted">Separate words or phrases with commas. Case doesn&apos;t matter. For Channel, type email or chat; for Status, open, pending or closed. Leave a row empty to skip it.</p>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 font-medium" htmlFor={`ttags-${key}`}>Add tags<TagInput tags={tags} id={`ttags-${key}`} name="addTags" defaultValue={tagAct?.type === "add_tags" ? tagAct.tags.join(", ") : ""} placeholder="billing" className={`${field} font-normal`} /></label>
        <label className="grid gap-1.5 font-medium" htmlFor={`tassign-${key}`}>Assign to
          <select id={`tassign-${key}`} name="assignTo" defaultValue={assignAct?.type === "assign" ? assignAct.to : ""} className={`${field} font-normal`}>
            <option value="">Leave as is</option>
            {agents.map((a) => <option key={a.userId} value={a.userId}>{a.name}</option>)}
          </select>
        </label>
        {groups.length > 0 && (
          <label className="grid gap-1.5 font-medium" htmlFor={`tgroup-${key}`}>Send to group
            <select id={`tgroup-${key}`} name="groupId" defaultValue={groupAct?.type === "group" ? groupAct.groupId : ""} className={`${field} font-normal`}>
              <option value="">No group</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        )}
        <label className="grid gap-1.5 font-medium" htmlFor={`tstatus-${key}`}>Set status
          <select id={`tstatus-${key}`} name="setStatus" defaultValue={statusAct?.type === "set_status" ? statusAct.status : ""} className={`${field} font-normal`}>
            <option value="">Leave as is</option>
            <option value="open">Open</option>
            <option value="pending">Pending</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        <label className="grid gap-1.5 font-medium" htmlFor={`tnote-${key}`}>Note for the team<input id={`tnote-${key}`} name="note" maxLength={2000} defaultValue={noteAct?.type === "note" ? noteAct.body : ""} placeholder="Check the order in Shopify first" className={`${field} font-normal`} /></label>
      </div>
      <label className="grid gap-1.5 font-medium" htmlFor={`treply-${key}`}>Email the customer (timed triggers only)
        <textarea id={`treply-${key}`} name="reply" rows={3} maxLength={5000} defaultValue={replyAct?.type === "reply" ? replyAct.body : ""} placeholder="Just checking in: did that sort it out? Reply to this email if you still need help, or we'll close this in a few days." className={`${field} font-normal`} />
      </label>
      <p className="text-xs text-muted">The AI only answers tickets that are still open, so a trigger that sets pending or closed keeps the AI off them. A timed trigger runs once on a ticket until the customer or your team writes again, so a nudge isn&apos;t sent twice. The email goes out from your team&apos;s address, marked as automatic.</p>
      <button className="btn btn-primary w-max">{trigger ? "Save trigger" : "Add trigger"}</button>
    </form>
  );
}

const LEARNED_VERB = { added: "Learned", updated: "Updated", retired: "Retired", flagged: "Looks out of date" } as const;

// What the AI changed in its own knowledge lately (lib/learn.ts).
function LearnedLog({ rows }: { rows: Awaited<ReturnType<typeof recentLearning>> }) {
  return (
    <section id="learned" className="card grid scroll-mt-6 gap-3 p-5">
      <div className="grid gap-1">
        <h2 className="font-semibold">What the AI learned lately</h2>
        <p className="text-sm text-muted">From tickets your team solved. Learned answers are in the list below; edit or delete any of them and the AI follows.</p>
      </div>
      <ul className="grid gap-2.5 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="grid gap-0.5">
            <span>
              <span className={r.kind === "flagged" ? "font-medium text-warn" : "font-medium"}>{LEARNED_VERB[r.kind as keyof typeof LEARNED_VERB]}:</span> {r.name}
              <span className="text-muted"> · {r.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            </span>
            {r.detail && <span className="text-muted">{r.detail}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
