import { clerkClient } from "@clerk/nextjs/server";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CopyButton, InviteForm, TestEmailButton, WaitFor } from "@/components/onboarding";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { clerkEnabled } from "@/lib/auth-config";
import { emailConfig, inboundAddress } from "@/lib/email";
import { ADAPTERS } from "@/lib/import/engine";
import { getOnboarding, type StepId } from "@/lib/onboarding";
import { PLAN, usd } from "@/lib/pricing";
import { listAgents } from "@/lib/tickets";
import {
  confirmForwardingAction,
  createSampleTicketAction,
  dismissOnboardingAction,
  revokeInviteAction,
  saveSupportEmailAction,
  skipStepAction,
} from "./actions";

export const metadata = { title: "Get started" };

const STEP_IDS: StepId[] = ["team", "invite", "inbox", "import", "test"];

export default async function WelcomePage({ searchParams }: PageProps<"/app/welcome">) {
  const s = await requireSession();
  if (s.role !== "admin") redirect("/app/inbox");
  const o = await getOnboarding(s.orgId);
  const { org, ob, steps } = o;
  const asked = (await searchParams).step;
  const current: StepId | null = STEP_IDS.includes(asked as StepId) ? (asked as StepId) : (steps.find((x) => !x.done)?.id ?? null);
  const address = inboundAddress(org.inboundKey);
  const canSendTest = Boolean(emailConfig.apiKey && emailConfig.from && address);

  const [members, invitations, lastImport, external] = await Promise.all([
    listAgents(s.orgId),
    clerkEnabled
      ? (await clerkClient()).organizations
          .getOrganizationInvitationList({ organizationId: s.orgId, status: ["pending"] })
          .then((r) => r.data.map((i) => ({ id: i.id, email: i.emailAddress })))
          .catch(() => [])
      : Promise.resolve((ob.invited ?? []).map((email) => ({ id: "", email }))),
    db.query.imports.findFirst({ where: eq(schema.imports.orgId, s.orgId), orderBy: [desc(schema.imports.createdAt)] }),
    db
      .select({ name: schema.externalAgents.name, email: schema.externalAgents.email, source: schema.externalAgents.source })
      .from(schema.externalAgents)
      .where(
        and(
          eq(schema.externalAgents.orgId, s.orgId),
          isNull(schema.externalAgents.linkedUserId),
          isNotNull(schema.externalAgents.email),
          eq(schema.externalAgents.active, true),
        ),
      ),
  ]);
  const taken = new Set([...members.map((m) => m.email.toLowerCase()), ...invitations.map((i) => i.email.toLowerCase())]);
  // One suggestion per person, even if they were in more than one imported tool.
  const suggestions = [...new Map(external.filter((a) => a.email && !taken.has(a.email)).map((a) => [a.email!, { name: a.name, email: a.email! }])).values()];
  const suggestionSource = external[0] ? ADAPTERS[external[0].source].name : null;

  const status: Record<StepId, string> = {
    team: org.name,
    invite: members.length > 1 ? `${members.length} people on the team` : invitations.length ? `${invitations.length} invited` : "Just you so far",
    inbox: o.inboundSeen || o.testEmailArrived ? "Email is arriving" : ob.forwardingConfirmed ? "Forwarding set up" : org.supportEmail ? `Waiting for ${org.supportEmail}` : "Not connected",
    import: lastImport ? `${ADAPTERS[lastImport.source].name} import ${lastImport.status === "running" ? "running" : lastImport.status === "done" ? "finished" : lastImport.status}` : "Not started",
    test: o.testTicket ? `Ticket #${o.testTicket.number} arrived` : "Not sent",
  };

  const content: Record<StepId, React.ReactNode> = {
    team: (
      <div className="grid gap-2 text-sm">
        <p>
          <strong>{org.name}</strong> is ready and you&apos;re its admin.
        </p>
        <p className="text-muted">
          Flatdesk is {usd(PLAN.seatPrice)} per agent a month, with {PLAN.includedPerAgent} AI resolutions per agent included. When they run out
          the AI pauses, so the bill never surprises you. You can change that in <Link href="/app/settings" className="link">Settings</Link>.
        </p>
      </div>
    ),

    invite: (
      <div className="grid gap-5">
        {(members.length > 1 || invitations.length > 0) && (
          <ul className="grid gap-1.5 text-sm">
            {members.map((m) => (
              <li key={m.userId} className="flex flex-wrap justify-between gap-2">
                <span>
                  {m.name} <span className="text-muted">{m.email}</span>
                </span>
                <span className="chip capitalize">{m.role}</span>
              </li>
            ))}
            {invitations.map((i) => (
              <li key={i.email} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted">{i.email}</span>
                <span className="flex items-center gap-3">
                  <span className="chip">Invited</span>
                  {i.id && (
                    <form action={revokeInviteAction}>
                      <input type="hidden" name="invitationId" value={i.id} />
                      <button className="link text-xs text-muted">Revoke</button>
                    </form>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <InviteForm suggestions={suggestions} source={suggestionSource} />
        {!clerkEnabled && <p className="text-xs text-muted">Local development: invites are recorded but not emailed.</p>}
      </div>
    ),

    inbox: address ? (
      <div className="grid gap-5 text-sm">
        <form action={saveSupportEmailAction} className="grid gap-1.5">
          <label htmlFor="supportEmail" className="label">1. Your support address</label>
          <div className="flex max-w-md gap-2">
            <input id="supportEmail" name="supportEmail" type="email" defaultValue={org.supportEmail ?? ""} placeholder="support@yourcompany.com" className="field" />
            <button className="btn btn-secondary">Save</button>
          </div>
          <span className="text-xs text-muted">The address your customers write to today. It stays the same.</span>
        </form>

        <div className="grid gap-1.5">
          <p className="label">2. Forward it to Flatdesk</p>
          <div className="flex max-w-full flex-wrap items-center gap-2">
            <code className="num select-all break-all rounded-lg border border-dashed border-accent/40 bg-accent-soft px-3 py-2">{address}</code>
            <CopyButton text={address} />
          </div>
        </div>

        {ob.gmailConfirmation && !o.inboundSeen && (
          <div className="rounded-lg bg-warn-soft px-4 py-3">
            <p className="font-medium">Gmail sent a confirmation{ob.gmailConfirmation.code ? ` code: ${ob.gmailConfirmation.code}` : ""}</p>
            <p className="text-muted">
              Enter it in Gmail&apos;s forwarding settings
              {ob.gmailConfirmation.link && (
                <>
                  , or{" "}
                  <a href={ob.gmailConfirmation.link} target="_blank" rel="noreferrer" className="link">
                    confirm with this link
                  </a>
                </>
              )}
              . Forwarding starts after that.
            </p>
          </div>
        )}

        <div className="grid gap-2">
          <p className="label">How to forward</p>
          <details className="rounded-lg border border-line px-4 py-2.5">
            <summary className="cursor-pointer font-medium">Gmail or Google Workspace</summary>
            <ol className="mt-2 grid list-decimal gap-1 pl-5 text-muted">
              <li>Sign in to the support mailbox and open Settings, then See all settings, then Forwarding and POP/IMAP.</li>
              <li>Click Add a forwarding address and paste the Flatdesk address.</li>
              <li>Gmail emails a confirmation code. It appears on this page within a few seconds.</li>
              <li>Enter the code, choose Forward a copy of incoming mail, and save.</li>
            </ol>
            <p className="mt-2 text-muted">If support@ is a Google Group, add the Flatdesk address as a member instead.</p>
          </details>
          <details className="rounded-lg border border-line px-4 py-2.5">
            <summary className="cursor-pointer font-medium">Microsoft 365 or Outlook</summary>
            <ol className="mt-2 grid list-decimal gap-1 pl-5 text-muted">
              <li>In Outlook on the web, open Settings, then Mail, then Forwarding.</li>
              <li>Turn on forwarding, paste the Flatdesk address, and keep a copy of forwarded messages.</li>
              <li>If your admin blocks external forwarding, ask them to allow it for this mailbox in the Microsoft 365 Defender outbound spam policy.</li>
            </ol>
          </details>
          <details className="rounded-lg border border-line px-4 py-2.5">
            <summary className="cursor-pointer font-medium">Anything else</summary>
            <p className="mt-2 text-muted">
              Add a forwarding rule or alias that sends every email for your support address to the Flatdesk address. Keeping a copy in the
              old mailbox is fine; Flatdesk ignores duplicates.
            </p>
          </details>
        </div>

        {o.inboundSeen ? (
          <p className="text-accent">Email is arriving. You&apos;re connected.</p>
        ) : (
          <div className="grid gap-3">
            {current === "inbox" && org.supportEmail && <WaitFor label={`Waiting for the first email forwarded from ${org.supportEmail}…`} />}
            {!ob.forwardingConfirmed && (
              <form action={confirmForwardingAction}>
                <button className="btn btn-secondary btn-sm">I&apos;ve set up forwarding</button>
              </form>
            )}
          </div>
        )}
      </div>
    ) : (
      <p className="text-sm text-muted">Email isn&apos;t connected on this server yet, so there&apos;s no address to forward to. Skip this for now.</p>
    ),

    import: (
      <div className="grid gap-4 text-sm">
        {lastImport ? (
          <p>
            <Link href={`/app/import/${lastImport.id}`} className="link">
              {lastImport.status === "running" ? "See the import in progress" : "See the import report"}
            </Link>
            <span className="text-muted">, or import from another tool below.</span>
          </p>
        ) : (
          <p className="text-muted">
            Tickets with their full history, macros, tags, rules, contacts and agents. Nothing is dropped: anything that doesn&apos;t fit is
            listed in a report and kept in an archive.
          </p>
        )}
        <ul className="grid gap-2 sm:grid-cols-2">
          {Object.values(ADAPTERS).map((a) => (
            <li key={a.id}>
              <Link href={`/app/import/new/${a.id}`} className="btn btn-secondary w-full justify-between">
                {a.name}
                <span aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    ),

    test: (
      <div className="grid gap-4 text-sm">
        {o.testTicket ? (
          <p>
            <Link href={`/app/tickets/${o.testTicket.number}`} className="link font-medium">
              Ticket #{o.testTicket.number}
            </Link>{" "}
            arrived{o.testEmailArrived ? " through your forwarding, so email works end to end" : ""}. Open it and try a reply, a note and a macro.
          </p>
        ) : (
          <>
            {canSendTest && org.supportEmail ? (
              <div className="grid gap-2">
                <p className="text-muted">
                  Flatdesk emails {org.supportEmail}. If forwarding works, it comes back here as a ticket, the same way a customer&apos;s email would.
                </p>
                <TestEmailButton to={org.supportEmail} />
                {ob.testSentAt && current === "test" && (
                  <>
                    <WaitFor label="Test email sent. Waiting for it to come back…" />
                    <p className="text-xs text-muted">
                      Nothing after a minute? Check the forwarding rule, and in Gmail, that the confirmation code was entered.
                    </p>
                  </>
                )}
              </div>
            ) : (
              <p className="text-muted">
                {address ? "Save your support address in the inbox step to send a real test email." : "Email isn't connected on this server yet."}
              </p>
            )}
            <form action={createSampleTicketAction} className="grid gap-1">
              <button className="link w-max">Create a sample ticket instead</button>
              <span className="text-xs text-muted">Useful for a look around before email is set up.</span>
            </form>
          </>
        )}
      </div>
    ),
  };

  const pct = Math.round((o.doneCount / steps.length) * 100);

  return (
    <div className="grid max-w-3xl gap-6 px-4 py-6 md:px-8 md:py-8">
      <header className="grid gap-3">
        <p className="eyebrow">Getting started</p>
        <h1 className="font-display text-3xl">{o.complete ? "You're all set" : `Welcome to Flatdesk, ${org.name}`}</h1>
        <div className="grid max-w-sm gap-1.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={o.doneCount} aria-valuemin={0} aria-valuemax={steps.length} aria-label="Setup progress">
            <div className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
          </div>
          <p className="num text-xs text-muted">
            {o.doneCount} of {steps.length} done
          </p>
        </div>
      </header>

      <ol className="grid gap-3">
        {steps.map((step, i) => (
          <li key={step.id} id={step.id} className="card overflow-hidden">
            <details open={current === step.id}>
              <summary className="flex cursor-pointer items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2/60">
                <span
                  aria-hidden="true"
                  className={`num grid size-8 shrink-0 place-items-center rounded-full text-sm ${
                    step.done && !step.skipped ? "bg-accent text-accent-ink" : current === step.id ? "border-2 border-accent text-accent" : "border border-line-strong text-muted"
                  }`}
                >
                  {step.done && !step.skipped ? (
                    <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 10.5l3.2 3.2L15 7" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="grid min-w-0 flex-1">
                  <span className="font-medium">{step.title}</span>
                  <span className="truncate text-sm text-muted">
                    <span className="sr-only">{step.done ? (step.skipped ? "Skipped. " : "Done. ") : ""}</span>
                    {step.skipped ? "Skipped for now" : status[step.id]}
                  </span>
                </span>
                <svg viewBox="0 0 20 20" className="chevron size-4 shrink-0 text-muted transition-transform" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M5 8l5 5 5-5" />
                </svg>
              </summary>
              <div className="grid gap-4 border-t border-line px-5 py-5">
                {content[step.id]}
                {step.id !== "team" && !step.done && (
                  <form action={skipStepAction}>
                    <input type="hidden" name="step" value={step.id} />
                    <button className="link text-sm text-muted">{step.id === "import" ? "We're starting fresh" : "Skip for now"}</button>
                  </form>
                )}
              </div>
            </details>
          </li>
        ))}
      </ol>

      {o.complete ? (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
          <p>Your inbox is ready for customers.</p>
          <form action={dismissOnboardingAction}>
            <button className="btn btn-primary">Open the inbox</button>
          </form>
        </div>
      ) : (
        <form action={dismissOnboardingAction}>
          <button className="link text-sm text-muted">Hide this checklist</button>
        </form>
      )}
    </div>
  );
}
