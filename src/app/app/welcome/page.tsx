import { clerkClient } from "@clerk/nextjs/server";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CopyButton, InviteForm, TestEmailButton, TryAi, WaitFor } from "@/components/onboarding";
import { db, schema } from "@/db";
import { aiConfigured, loadKnowledge } from "@/lib/ai";
import { requireSession } from "@/lib/auth";
import { clerkEnabled } from "@/lib/auth-config";
import { emailConfig, inboundAddress } from "@/lib/email";
import { ADAPTERS } from "@/lib/import/engine";
import { getOnboarding, type StepId } from "@/lib/onboarding";
import { PLAN, usd } from "@/lib/pricing";
import { pickTickets } from "@/lib/test-drive";
import { listAgents } from "@/lib/tickets";
import {
  confirmForwardingAction,
  confirmWidgetAction,
  createSampleTicketAction,
  dismissOnboardingAction,
  revokeInviteAction,
  saveSupportEmailAction,
  skipStepAction,
} from "./actions";

export const metadata = { title: "Get started" };

const STEP_IDS: StepId[] = ["team", "ai", "inbox", "invite", "import", "test"];

export default async function WelcomePage({ searchParams }: PageProps<"/app/welcome">) {
  const s = await requireSession();
  if (s.role !== "admin") redirect("/app/inbox");
  const o = await getOnboarding(s.orgId);
  const { org, ob, steps } = o;
  const asked = (await searchParams).step;
  const current: StepId | null = STEP_IDS.includes(asked as StepId) ? (asked as StepId) : (steps.find((x) => !x.done)?.id ?? null);
  const address = inboundAddress(org.inboundKey);
  const canSendTest = Boolean(emailConfig.apiKey && emailConfig.from && address);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const siteOrigin = `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
  const ai = aiConfigured();
  const widgetTag = `<script src="${siteOrigin}/widget.js" data-key="${org.widgetKey}" async></script>`;
  // Forwarding often needs whoever runs the company's email. This hands them everything in one message.
  const itMail = `mailto:?subject=${encodeURIComponent("Please forward our support email to Flatdesk")}&body=${encodeURIComponent(
    [
      `Hi, we're moving ${org.supportEmail ?? "our support address"} to Flatdesk. Could you forward a copy of every email it receives to:`,
      "",
      address ?? "",
      "",
      "Gmail or Google Workspace: Settings, Forwarding and POP/IMAP, Add a forwarding address, then enter the confirmation code Gmail sends (it shows up in Flatdesk for me) and choose Forward a copy. If it's a Google Group, add the address as a member instead.",
      "Microsoft 365: Outlook on the web, Settings, Mail, Forwarding, keep a copy. If external forwarding is blocked, allow it for this mailbox in the Microsoft 365 Defender outbound spam policy.",
      "",
      "Keeping a copy in the old mailbox is fine. Thanks!",
    ].join("\n"),
  )}`;

  const [members, invitations, lastImport, external, knowledge, testable] = await Promise.all([
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
    ai ? loadKnowledge(s.orgId) : Promise.resolve([]),
    // Past tickets the test drive can draft: usually there once an import finishes.
    ai ? pickTickets(s.orgId).then((ids) => ids.length) : Promise.resolve(0),
  ]);
  const taken = new Set([...members.map((m) => m.email.toLowerCase()), ...invitations.map((i) => i.email.toLowerCase())]);
  // One suggestion per person, even if they were in more than one imported tool.
  const suggestions = [...new Map(external.filter((a) => a.email && !taken.has(a.email)).map((a) => [a.email!, { name: a.name, email: a.email! }])).values()];
  const suggestionSource = external[0] ? ADAPTERS[external[0].source].name : null;

  const status: Record<StepId, string> = {
    team: org.name,
    ai: steps.find((x) => x.id === "ai")?.done ? "The AI has answered" : org.aiInstructions.trim() ? "Notes saved, not tried yet" : "Not tried yet",
    invite: members.length > 1 ? `${members.length} people on the team` : invitations.length ? `${invitations.length} invited` : "Just you so far",
    inbox: o.inboundSeen || o.testEmailArrived ? "Email is arriving" : o.chatSeen ? "Chat is working" : ob.widgetAdded ? "Chat widget added" : ob.forwardingConfirmed ? "Forwarding set up" : org.supportEmail ? `Waiting for ${org.supportEmail}` : "Not connected",
    import: lastImport ? `${ADAPTERS[lastImport.source].name} import ${lastImport.status === "running" ? "running" : lastImport.status === "done" ? "finished" : lastImport.status}` : "Not started",
    test: o.inboundSeen || o.testEmailArrived ? "Email came through" : o.chatSeen ? "A chat came through" : "Nothing yet",
  };

  const content: Record<StepId, React.ReactNode> = {
    team: (
      <div className="grid gap-2 text-sm">
        <p>
          <strong>{org.name}</strong> is ready and you&apos;re its admin.
        </p>
        <p className="text-muted">
          Flatdesk is {usd(PLAN.seatPrice)} per agent a month ({usd(PLAN.annualSeatPrice)} billed yearly), with {PLAN.includedPerAgent} AI answers per agent included. When they run out, the AI pauses and the bill stays the same. You can change that in <Link href="/app/settings" className="link">Settings</Link>.
        </p>
      </div>
    ),

    ai: ai ? (
      <div className="grid gap-4 text-sm">
        <p className="text-muted">
          Write a few lines about your business, then ask something a customer might. You&apos;ll see the reply the AI would send. Nobody else sees it and it doesn&apos;t count toward your AI answers.
        </p>
        <TryAi notes={org.aiInstructions} saved={knowledge.length} />
        {testable > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-4 py-3">
            <span>
              <span className="font-medium">Want to see it on real tickets?</span>{" "}
              <span className="text-muted">The test drive writes replies to {testable} of your past tickets so you can compare them with what your team sent.</span>
            </span>
            <Link href="/app/test-drive" className="btn btn-secondary btn-sm">
              Start the test drive
            </Link>
          </div>
        )}
      </div>
    ) : (
      <p className="text-sm text-muted">The AI isn&apos;t connected on this server yet. Skip this for now.</p>
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

    inbox: (
      <div className="grid gap-6 text-sm">
        <p className="text-muted">
          Pick whichever is quicker. Chat is one line of code on your site. Email needs a forwarding rule in your mail settings. You can add the other later in Settings.
        </p>

        <section className="grid gap-3" aria-labelledby="chat-option">
          <h3 id="chat-option" className="font-medium">Website chat</h3>
          <p className="text-muted">Paste this just before &lt;/body&gt; on your site. Each chat shows up here as a ticket, and the AI replies when it can.</p>
          <div className="flex max-w-full flex-wrap items-center gap-2">
            <code className="num select-all break-all rounded-lg border border-dashed border-accent/40 bg-accent-soft px-3 py-2">{widgetTag}</code>
            <CopyButton text={widgetTag} />
          </div>
          <p className="text-muted">
            Can&apos;t edit your site yet?{" "}
            <a href={`/chat/${org.widgetKey}`} target="_blank" rel="noreferrer" className="link text-accent">
              Open your chat page
            </a>{" "}
            and send yourself a message. You can also share that link with customers.
          </p>
          {o.chatSeen ? (
            <p className="text-accent">A chat came in, so chat is working.</p>
          ) : (
            !ob.widgetAdded && (
              <form action={confirmWidgetAction}>
                <button className="btn btn-secondary btn-sm">I&apos;ve added it to my site</button>
              </form>
            )
          )}
        </section>

        <section className="grid gap-3 border-t border-line pt-5" aria-labelledby="email-option">
          <h3 id="email-option" className="font-medium">Email</h3>
          {address ? (
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
                  Add a forwarding rule or alias that sends your support email to the Flatdesk address. Keeping a copy in the old mailbox is fine. Flatdesk ignores duplicates.
                </p>
              </details>
              <a href={itMail} className="link w-max text-accent">
                Email these steps to your IT person
              </a>
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
            <p className="text-muted">Email isn&apos;t connected on this server yet, so there&apos;s no address to forward to.</p>
          )}
        </section>
      </div>
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
            Brings over your tickets with their full history, plus macros, tags, rules, contacts and agents. Anything that doesn&apos;t fit is listed in a report and kept.
          </p>
        )}
        <ul className="grid gap-2 sm:grid-cols-2">
          {Object.values(ADAPTERS).map((a) => (
            <li key={a.id}>
              <Link href={`/app/import/new/${a.id}`} className="btn btn-secondary w-full">
                {a.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    ),

    test: (
      <div className="grid gap-4 text-sm">
        {o.inboundSeen || o.testEmailArrived || o.chatSeen ? (
          <p>
            {o.testEmailArrived && o.testTicket ? (
              <>
                <Link href={`/app/tickets/${o.testTicket.number}`} className="link font-medium">
                  Ticket #{o.testTicket.number}
                </Link>{" "}
                came back through your forwarding, so email is working.
              </>
            ) : o.inboundSeen ? (
              "A customer email came through your forwarding."
            ) : (
              "A chat came through your widget."
            )}{" "}
            <Link href="/app/inbox" className="link">Open the inbox</Link> to see it and how the AI handled it.
          </p>
        ) : (
          <>
            <p className="text-muted">Send a message the way a customer would. Once it shows up here as a ticket, you know customers can reach you.</p>
            <p>
              <a href={`/chat/${org.widgetKey}`} target="_blank" rel="noreferrer" className="link text-accent">
                Open your chat page
              </a>{" "}
              <span className="text-muted">and ask a question. If your notes cover it, the AI replies in the chat.</span>
            </p>
            {canSendTest && org.supportEmail && (
              <div className="grid gap-2">
                <p className="text-muted">
                  To test email instead, we&apos;ll send a message to {org.supportEmail}. If forwarding works, it shows up here as a ticket.
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
            )}
            {current === "test" && !(ob.testSentAt && canSendTest && org.supportEmail) && <WaitFor label="Waiting for your message…" />}
            {o.testTicket ? (
              <p className="text-xs text-muted">
                Your sample ticket is{" "}
                <Link href={`/app/tickets/${o.testTicket.number}`} className="link">
                  #{o.testTicket.number}
                </Link>
                . It&apos;s only for looking around, so it doesn&apos;t count for this step.
              </p>
            ) : (
              <form action={createSampleTicketAction} className="grid gap-1">
                <button className="link w-max">Create a sample ticket to look around</button>
                <span className="text-xs text-muted">It won&apos;t complete this step. Only a real message does.</span>
              </form>
            )}
          </>
        )}
      </div>
    ),
  };

  const pct = Math.round((o.doneCount / steps.length) * 100);

  return (
    <div className="grid max-w-3xl gap-6 px-4 py-6 md:px-8 md:py-8">
      <header className="grid gap-3">
        <h1 className="page-title">{o.complete ? "You're all set" : `Welcome to Flatdesk, ${org.name}`}</h1>
        <div className="grid max-w-sm gap-1.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={o.doneCount} aria-valuemin={0} aria-valuemax={steps.length} aria-label="Setup progress">
            <div className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
          </div>
          <p className="num text-xs text-muted">
            {o.doneCount} of {steps.length} done
          </p>
        </div>
      </header>

      <ol className="card divide-y divide-line overflow-hidden">
        {steps.map((step, i) => (
          <li key={step.id} id={step.id}>
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
