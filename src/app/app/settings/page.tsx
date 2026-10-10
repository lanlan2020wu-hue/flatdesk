import LocalTime from "@/components/LocalTime";
import { getBackupTarget } from "@/lib/backups";
import { backUpNowAction, removeBackupAction, saveBackupAction } from "./backup-actions";
import { AFTER_HOURS_MAX } from "@/lib/after-hours";
import Link from "next/link";
import { and, asc, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import HowItWorks from "@/components/HowItWorks";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { aiConfigured, aiUsage } from "@/lib/ai";
import { access, billingConfigured, isActive, refreshSubscription, seatCount, trialEndsAt } from "@/lib/billing";
import DnsTable from "@/components/DnsTable";
import { emailConfig, inboundAddress, senderAddress } from "@/lib/email";
import { checkSendDomain, sendDomainsConfigured } from "@/lib/send-domain";
import { MAILBOX_NAMES, mailboxFor, type MailboxKind } from "@/lib/mailbox";
import { gmailConfigured } from "@/lib/mailbox/gmail";
import { microsoftConfigured } from "@/lib/mailbox/microsoft";
import { PLAN, annualSavingsPct, usd } from "@/lib/pricing";
import { OPTIONAL_EVENTS, webhookKind, webhookLabel } from "@/lib/alerts";
import { DEFAULT_HOURS, RESOLVE_CHOICES, TARGET_CHOICES } from "@/lib/sla";
import { timeAgo } from "@/lib/format";
import { LANGUAGES } from "@/lib/language";
import { TRASH_DAYS } from "@/lib/trash";
import { listSources, WEB } from "@/lib/web-knowledge";
import { FIELD_KINDS, FIELD_LIMITS, listFields, type TicketField } from "@/lib/ticket-fields";
import { currentUser } from "@clerk/nextjs/server";
import { BrowserAlertsToggle } from "@/components/BrowserAlerts";
import { clerkEnabled } from "@/lib/auth-config";
import {
  openBillingPortalAction,
  saveAiSettingsAction,
  saveFieldDefinitionAction,
  deleteFieldDefinitionAction,
  addWebSourceAction,
  readWebSourceAction,
  removeWebSourceAction,
  saveAlertsAction,
  saveSendAddressAction,
  disconnectMailboxAction,
  checkSendAddressAction,
  saveBlocklistAction,
  saveSecurityAction,
  saveLanguageAction,
  saveSignatureAction, saveDigestAction,
  saveServiceSettingsAction,
  sendTestAlertAction,
  setViewerAction,
  startCheckoutAction,
  switchToAnnualAction,
} from "../actions";

export const metadata = { title: "Settings" };

const STATUS_TEXT: Record<string, string> = {
  trialing: "Free trial",
  active: "Active",
  past_due: "Payment failed, retrying",
  canceled: "Cancelled",
  unpaid: "Unpaid",
  incomplete: "Waiting for payment",
  incomplete_expired: "Checkout expired",
  paused: "Paused",
};

export default async function SettingsPage({ searchParams }: PageProps<"/app/settings">) {
  const s = await requireSession();
  const { billing, alerts: alertsNotice, service: serviceNotice, security: securityNotice, send: sendNotice, blocked: blockedNotice, mailbox: mailboxNotice, web: webNotice, fields: fieldsNotice, backup: backupNotice } = await searchParams;
  // A team's own sending address waiting on DNS: look again on each visit, so the page is current.
  const pendingSend = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId), columns: { sendDomainId: true, sendDomainVerifiedAt: true } });
  if (pendingSend?.sendDomainId && !pendingSend.sendDomainVerifiedAt && !sendNotice) await checkSendDomain(s.orgId);
  let org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId) });
  if (org?.stripeCustomerId && billingConfigured()) {
    org = await refreshSubscription(s.orgId).catch(() => org);
  }
  const seats = await seatCount(s.orgId).catch(() => 1);
  const subscribed = isActive(org?.subscriptionStatus);
  const plan = org ? access(org) : ({ state: "open" } as const);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const siteOrigin = `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
  const address = org ? inboundAddress(org.inboundKey) : null;
  const mailbox = await mailboxFor(s.orgId);
  const usage = await aiUsage(s.orgId);
  const [sites, ticketFieldList, backupTarget] = await Promise.all([listSources(s.orgId), listFields(s.orgId), getBackupTarget(s.orgId)]);
  const pct = Math.min(100, Math.round((usage.used / usage.included) * 100));
  const isAdmin = s.role === "admin";
  const yearly = subscribed && org?.billingInterval === "year";
  const hours = org?.businessHours ?? DEFAULT_HOURS;
  const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const zones = Intl.supportedValuesOf("timeZone");
  const myTwoFactor = clerkEnabled ? Boolean((await currentUser())?.twoFactorEnabled) : false;
  const team = await db.select().from(schema.agents).where(and(eq(schema.agents.orgId, s.orgId), isNull(schema.agents.removedAt))).orderBy(asc(schema.agents.name));

  return (
    <div className="grid max-w-2xl gap-10 px-4 py-6 md:px-8 md:py-8">
      <h1 className="page-title">Settings</h1>
      {!s.viewer && (
        <section id="signature" className="grid scroll-mt-6 gap-3 border-t border-line pt-6">
          <h2 className="text-lg font-semibold">Your signature</h2>
          <p className="text-muted">Added under every reply you send, by email or chat. Not under internal notes or AI answers. Everyone on the team sets their own.</p>
          <form action={saveSignatureAction} className="grid gap-2">
            <textarea name="signature" rows={3} maxLength={1000} defaultValue={team.find((a) => a.userId === s.userId)?.signature ?? ""} placeholder={"Sam\nAcme support"} className="field text-sm" aria-label="Your signature" />
            <button className="btn btn-secondary btn-sm w-max">Save signature</button>
          </form>
        </section>
      )}
      <section id="daily-summary" className="grid scroll-mt-6 gap-3 border-t border-line pt-6">
        <h2 className="text-lg font-semibold">Daily summary</h2>
        <p className="text-muted">One email a day with what&apos;s waiting on you: customers waiting for your reply, tickets assigned to you, open tickets nobody has, and overdue ones. Nothing is sent on days when there&apos;s nothing to do. Each person chooses for themselves.</p>
        <form action={saveDigestAction} className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2.5">
            <input type="checkbox" name="digest" defaultChecked={team.find((a) => a.userId === s.userId)?.digest ?? false} className="size-4 accent-[var(--accent)]" />
            Email me the daily summary
          </label>
          <button className="btn btn-secondary btn-sm">Save</button>
        </form>
      </section>
      {!s.viewer && (
        <section id="browser-alerts" className="grid scroll-mt-6 gap-3 border-t border-line pt-6">
          <h2 className="text-lg font-semibold">Browser alerts</h2>
          <p className="text-muted">
            A desktop notification when a new ticket needs a person (not ones the AI answered) or a ticket is assigned to you, while Flatdesk is open in a
            tab you aren&apos;t looking at. New-ticket alerts cover unassigned tickets with no group or one of your groups. Each person turns them on in
            their own browser.
          </p>
          <BrowserAlertsToggle />
          <p className="text-sm text-muted">Press <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-xs">?</kbd> anywhere in Flatdesk to see the keyboard shortcuts.</p>
        </section>
      )}
      {org && (
        <section id="language" className="grid scroll-mt-6 gap-3 border-t border-line pt-6">
          <h2 className="text-lg font-semibold">Language</h2>
          <p className="text-muted">
            The language your team works in. When a customer writes in another one, their messages are translated for you when you open the ticket, and
            you can translate your reply into theirs before sending. The AI answers customers in their own language either way. Each translation is one
            copilot action.
          </p>
          <form action={saveLanguageAction} className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1">
              <span className="label">Team language</span>
              <select name="language" defaultValue={org.language} disabled={!isAdmin} className="field">
                {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </label>
            {isAdmin && <button className="btn btn-secondary">Save</button>}
          </form>
        </section>
      )}
      <section className="grid gap-3 border-t border-line pt-6">
        <h2 className="text-lg font-semibold">
          Email
        </h2>
        {(gmailConfigured() || microsoftConfigured() || mailbox) && (
          <Mailbox row={mailbox} isAdmin={isAdmin} notice={typeof mailboxNotice === "string" ? mailboxNotice : null} />
        )}
        {address ? (
          <>
            <p className="text-muted">
              Forward your support address (for example support@yourcompany.com) to this address. Every email that arrives becomes a
              ticket, and customer replies land on the same ticket.
            </p>
            <p className="num w-max max-w-full select-all break-all rounded-lg border border-dashed border-accent/40 bg-accent-soft px-3 py-2 text-sm">{address}</p>
            <p className="text-sm text-muted">
              Replies to customers are sent from {mailbox?.settings.mailbox ?? (org ? senderAddress(org) : emailConfig.from)} under your team&apos;s name, {org?.name}.
            </p>
            {org && !mailbox && (sendDomainsConfigured() || org.sendAddress) && (
              <SendingAddress org={org} isAdmin={isAdmin} notice={typeof sendNotice === "string" ? sendNotice : null} />
            )}
          </>
        ) : (
          <p className="text-muted">Email isn&apos;t connected on this server yet.</p>
        )}
      </section>

      {org && (
        <section className="grid gap-3 border-t border-line pt-6">
          <h2 className="text-lg font-semibold">Website chat</h2>
          <p className="text-muted">
            Paste this before the closing &lt;/body&gt; tag on your site. Visitors get a chat button. Their messages become tickets here, and your replies reach them in the chat and by email.
          </p>
          <pre className="num overflow-x-auto rounded-lg border border-dashed border-accent/40 bg-accent-soft px-3 py-2 text-sm select-all">
            {`<script src="${siteOrigin}/widget.js" data-key="${org.widgetKey}" async></script>`}
          </pre>
          <p className="text-sm text-muted">
            <a href={`/chat/${org.widgetKey}`} target="_blank" className="link text-accent">Open the chat window</a> to try it.
          </p>
          <details className="grid gap-2 text-sm">
            <summary className="link w-max cursor-pointer list-none text-accent">Chat inside your app, for signed-in users</summary>
            <div className="mt-2 grid gap-2">
              <p className="text-muted">
                Your server signs the user&apos;s email with this team&apos;s chat secret, and the page sets it before the script above. The chat skips the name and email form, and the ticket says the visitor was signed in, with any attributes you add (plan, account id). Keep the secret on your server. If the signature doesn&apos;t match, the ticket says so and the email counts as unconfirmed.
              </p>
              {isAdmin ? (
                <p>
                  Chat secret: <code className="num break-all rounded bg-surface-2 px-1.5 py-0.5 select-all">{org.chatSecret}</code>
                </p>
              ) : (
                <p className="text-muted">Admins can see the chat secret here.</p>
              )}
              <pre className="num overflow-x-auto rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-xs">{`<script>
  window.FlatdeskSettings = {
    email: user.email,
    name: user.name,
    // On your server: HMAC-SHA256 of the lowercased email, with the chat secret, as hex
    userHash: "<%= hmac_sha256(CHAT_SECRET, user.email.toLowerCase()) %>",
    attributes: { Plan: user.plan, "Account ID": user.accountId },
  };
</script>`}</pre>
            </div>
          </details>
        </section>
      )}

      <section className="grid gap-3 border-t border-line pt-6">
        <h2 className="text-lg font-semibold">Export</h2>
        <p className="text-muted">
          Your data is yours. Download it any time, no need to ask us. Moving from another help desk?{" "}
          <Link href="/app/import" className="link text-accent">Import everything</Link>.
        </p>
        <p className="text-sm">
          <a href="/app/export/archive" className="btn btn-sm w-max">Download everything (.zip)</a>
          <span className="mt-1 block text-muted">Every table, the help center, the audit log and every attachment as its original file.</span>
        </p>
        <ul className="grid gap-1.5 text-sm">
          {(["tickets", "messages", "customers", "macros"] as const).map((t) => (
            <li key={t} className="flex gap-3">
              <span className="w-24 font-medium capitalize">{t}</span>
              <a href={`/app/export?type=${t}`} className="link text-accent">CSV</a>
              <a href={`/app/export?type=${t}&format=json`} className="link text-accent">JSON</a>
            </li>
          ))}
        </ul>
      </section>

      <section id="backups" className="grid scroll-mt-6 gap-3 border-t border-line pt-6">
        <h2 className="text-lg font-semibold">Daily backup to your own storage</h2>
        <p className="text-muted">
          Every day Flatdesk uploads the full export (tickets, messages, customers, macros, help center, audit log and attachments) to a bucket you own on Amazon S3 or anything S3-compatible, like Cloudflare R2 or Backblaze B2. Create a bucket and a key that can only write to it. Flatdesk never deletes from it, so set the bucket&apos;s own rule to expire old copies.
        </p>
        {backupNotice === "saved" && <p className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm" role="status">Saved. A test file was written to your bucket.</p>}
        {backupNotice === "ran" && <p className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm" role="status">Backup uploaded.</p>}
        {backupNotice === "removed" && <p className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm" role="status">Backups are off.</p>}
        {typeof backupNotice === "string" && !["saved", "ran", "removed"].includes(backupNotice) && <p className="rounded-lg border border-warn/40 bg-surface-2/60 px-3 py-2 text-sm" role="alert">{backupNotice}</p>}
        {backupTarget && (
          <p className="text-sm text-muted">
            {backupTarget.enabled ? "On" : "Paused"} · {backupTarget.bucket}/{backupTarget.prefix}
            {backupTarget.lastRunAt && (
              <>
                {" "}· last run <LocalTime at={backupTarget.lastRunAt.toISOString()} />:{" "}
                {backupTarget.lastOk ? <span className="text-accent">uploaded {backupTarget.lastKey} ({Math.max(1, Math.round((backupTarget.lastBytes ?? 0) / 1024))} KB)</span> : <span className="text-warn">failed</span>}
              </>
            )}
            {backupTarget.lastError && <span className="block text-warn">{backupTarget.lastError}</span>}
          </p>
        )}
        {isAdmin ? (
          <>
            <form action={saveBackupAction} className="grid max-w-xl gap-3">
              <div className="flex flex-wrap gap-3">
                <label className="grid gap-1"><span className="label">Bucket</span><input name="bucket" required defaultValue={backupTarget?.bucket} placeholder="acme-flatdesk-backups" autoComplete="off" spellCheck={false} className="field field-sm" /></label>
                <label className="grid gap-1"><span className="label">Region</span><input name="region" required defaultValue={backupTarget?.region} placeholder="us-east-1" autoComplete="off" spellCheck={false} className="field field-sm w-32" /></label>
                <label className="grid gap-1"><span className="label">Folder</span><input name="prefix" defaultValue={backupTarget?.prefix ?? "flatdesk/"} autoComplete="off" spellCheck={false} className="field field-sm w-36" /></label>
              </div>
              <label className="grid gap-1">
                <span className="label">Endpoint (only if not Amazon S3)</span>
                <input name="endpoint" defaultValue={backupTarget?.endpoint ?? ""} placeholder="https://<account>.r2.cloudflarestorage.com" autoComplete="off" spellCheck={false} className="field field-sm" />
              </label>
              <div className="flex flex-wrap gap-3">
                <label className="grid gap-1"><span className="label">Access key ID</span><input name="accessKeyId" placeholder={backupTarget ? "Saved. Leave empty to keep it." : "AKIA…"} autoComplete="off" spellCheck={false} className="field field-sm" /></label>
                <label className="grid gap-1"><span className="label">Secret access key</span><input name="secretAccessKey" type="password" placeholder={backupTarget ? "Saved. Leave empty to keep it." : ""} autoComplete="new-password" className="field field-sm" /></label>
              </div>
              <label className="flex items-center gap-2.5"><input type="checkbox" name="includeFiles" defaultChecked={backupTarget?.includeFiles ?? true} className="size-4 accent-[var(--accent)]" />Include attachment files (left out automatically above 100 MB)</label>
              <label className="flex items-center gap-2.5"><input type="checkbox" name="enabled" defaultChecked={backupTarget?.enabled ?? true} className="size-4 accent-[var(--accent)]" />Back up every day</label>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-sm">{backupTarget ? "Save and test" : "Connect and test"}</button>
              </div>
            </form>
            {backupTarget && (
              <div className="flex flex-wrap gap-2">
                <form action={backUpNowAction}><button className="btn btn-secondary btn-sm">Back up now</button></form>
                <form action={removeBackupAction}><button className="btn btn-secondary btn-sm">Turn off and forget the keys</button></form>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">Only an admin can set this up.</p>
        )}
      </section>

      {org && (
        <section id="security" className="grid scroll-mt-6 gap-4 border-t border-line pt-6">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold">Security</h2>
            <p className="text-muted">
              For companies that review vendors. What each control does, and what Flatdesk does and doesn&apos;t have, is on the{" "}
              <a href="/security" className="link text-accent" target="_blank">security page</a>.
            </p>
          </div>
          {securityNotice === "saved" && <p className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm" role="status">Saved.</p>}
          {typeof securityNotice === "string" && securityNotice !== "saved" && <p className="rounded-lg border border-warn/40 bg-surface-2/60 px-3 py-2 text-sm" role="alert">{securityNotice}</p>}
          <form action={saveSecurityAction} className="grid gap-4">
            <fieldset disabled={!isAdmin} className="grid gap-4">
              <label className="flex items-start gap-2.5">
                <input type="checkbox" name="aiProcessing" defaultChecked={org.aiProcessing} className="mt-1 size-4 accent-[var(--accent)]" />
                <span>
                  Allow AI features
                  <span className="block text-sm text-muted">
                    Off: nothing from your team is sent to the AI provider. No AI answers, reply drafts, summaries, AI macros or test drive. Flatdesk
                    works as a plain help desk.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2.5">
                <input type="checkbox" name="requireTwoFactor" defaultChecked={org.requireTwoFactor} className="mt-1 size-4 accent-[var(--accent)]" />
                <span>
                  Require two-step verification for everyone
                  <span className="block text-sm text-muted">
                    Anyone without it is asked to add an authenticator app before they can open the help desk.
                    {clerkEnabled && !myTwoFactor && " Turn it on for your own account first, from your profile menu."}
                  </span>
                </span>
              </label>
              {isAdmin && <button className="btn btn-primary w-max">Save security settings</button>}
            </fieldset>
            {!isAdmin && <p className="text-sm text-muted">Only admins can change these.</p>}
          </form>
          {isAdmin && (
            <p className="text-sm">
              <Link href="/app/settings/audit" className="link text-accent">Audit log</Link>
              <span className="text-muted">: who changed settings and seats, exported data, imported or refunded.</span>
            </p>
          )}
          {isAdmin && (
            <p className="text-sm">
              <Link href="/app/settings/tags" className="link text-accent">Tags</Link>
              <span className="text-muted">: rename, merge or remove tags across every ticket.</span>
            </p>
          )}
        </section>
      )}

      {org && !s.viewer && (
        <section id="blocked" className="grid scroll-mt-6 gap-4 border-t border-line pt-6">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold">Blocked senders</h2>
            <p className="text-muted">
              Email from these senders goes straight to the trash: no AI answer, no alert, nothing in your views. One per line: a whole address, or{" "}
              <span className="font-mono text-sm">@example.com</span> for everyone at a domain. You can also block a sender from any email ticket.
            </p>
          </div>
          {typeof blockedNotice === "string" && <p className="rounded-lg border border-warn/40 bg-surface-2/60 px-3 py-2 text-sm" role="alert">{blockedNotice.slice(0, 300)}</p>}
          <form action={saveBlocklistAction} className="grid gap-3">
            <fieldset disabled={!isAdmin} className="grid gap-3">
              <textarea
                name="blocked"
                rows={Math.min(12, Math.max(4, org.blockedSenders.length + 1))}
                defaultValue={org.blockedSenders.join("\n")}
                placeholder={"spam@example.com\n@cold-outreach.io"}
                aria-label="Blocked senders, one per line"
                spellCheck={false}
                className="field font-mono text-sm"
              />
              {isAdmin && <button className="btn btn-primary w-max">Save blocked senders</button>}
            </fieldset>
            {!isAdmin && <p className="text-sm text-muted">Only admins can change this list.</p>}
          </form>
          <p className="text-sm">
            <Link href="/app/inbox?view=trash" className="link text-accent">Trash</Link>
            <span className="text-muted">: blocked email and deleted tickets, kept {TRASH_DAYS} days in case you need them back.</span>
          </p>
        </section>
      )}

      {org && !s.viewer && (
        <section id="fields" className="grid scroll-mt-6 gap-4 border-t border-line pt-6">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold">Ticket fields</h2>
            <p className="text-muted">
              Fields every ticket has in its side panel, like Plan, Order number or Refund issued. Mark one required and the team has to fill it in before closing a ticket. Search finds tickets by their field values. A field with the same name as one you imported picks up the imported values.
            </p>
          </div>
          {typeof fieldsNotice === "string" && <p className="rounded-lg border border-warn/40 bg-surface-2/60 px-3 py-2 text-sm" role="alert">{fieldsNotice.slice(0, 300)}</p>}
          {ticketFieldList.length > 0 && (
            <ul className="grid divide-y divide-line border-y border-line">
              {ticketFieldList.map((f) => (
                <li key={f.id} className="py-2.5">
                  <details>
                    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{f.name}</span>
                      <span className="text-sm text-muted">
                        {FIELD_KINDS.find((k) => k.id === f.kind)?.label}
                        {f.kind === "dropdown" && `: ${f.options.join(", ")}`}
                        {f.requiredToClose && " · required to close"}
                      </span>
                    </summary>
                    {isAdmin && (
                      <div className="mt-3 grid gap-3">
                        <FieldForm field={f} />
                        <form action={deleteFieldDefinitionAction}>
                          <input type="hidden" name="id" value={f.id} />
                          <button className="btn btn-secondary btn-sm text-warn">Delete field</button>
                          <span className="ml-2 text-xs text-muted">Values already on tickets stay, read only.</span>
                        </form>
                      </div>
                    )}
                  </details>
                </li>
              ))}
            </ul>
          )}
          {isAdmin && ticketFieldList.length < FIELD_LIMITS.max && (
            <details open={ticketFieldList.length === 0} className="grid gap-3">
              <summary className="link w-max cursor-pointer text-sm font-medium text-accent">Add a field</summary>
              <div className="mt-3"><FieldForm /></div>
            </details>
          )}
          {!isAdmin && <p className="text-sm text-muted">Only admins can change ticket fields.</p>}
        </section>
      )}

      <section id="billing" className="grid scroll-mt-6 gap-3 border-t border-line pt-6">
        <h2 className="text-lg font-semibold">Plan and billing</h2>
        {billing === "cancelled" && !subscribed && <p className="rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-sm" role="status">No card was added. You can do it whenever you&apos;re ready.</p>}
        {billing === "annual" && <p className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm" role="status">You&apos;re on yearly billing now. Any unused time on the monthly plan is credited on the first yearly invoice.</p>}
        {billing === "done" && <p className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm" role="status">Thanks, your plan is set up.</p>}
        {!billingConfigured() ? (
          <p className="text-muted">Billing isn&apos;t connected on this server yet.</p>
        ) : (
          <>
            <div className="grid gap-1 rounded-xl border border-line bg-surface-2/60 px-4 py-3">
              <p className="flex justify-between gap-2">
                <span>{subscribed ? STATUS_TEXT[org?.subscriptionStatus ?? ""] ?? org?.subscriptionStatus : plan.state === "trial" ? `Free trial, ${plan.daysLeft} ${plan.daysLeft === 1 ? "day" : "days"} left` : "No plan"}</span>
                <span className="num">
                  {yearly
                    ? `${seats} × ${usd(PLAN.annualSeatPrice)}/mo, billed yearly = ${usd(seats * PLAN.annualSeatPrice * 12)}/yr`
                    : `${seats} ${seats === 1 ? "seat" : "seats"} × ${usd(PLAN.seatPrice)} = ${usd(seats * PLAN.seatPrice)}/mo`}
                </span>
              </p>
              {!subscribed && org && plan.state === "trial" && (
                <p className="text-sm text-muted">
                  No card needed until {trialEndsAt(org).toLocaleDateString("en-US", { month: "long", day: "numeric" })}. Add one now and the first charge
                  still waits until then.
                </p>
              )}
              {subscribed && org?.currentPeriodEnd && (
                <p className="text-sm text-muted">
                  {org.subscriptionStatus === "trialing" ? "Trial ends" : "Renews"}{" "}
                  {org.currentPeriodEnd.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </p>
              )}
              <p className="text-sm text-muted">
                {yearly
                  ? "Seats follow your team. A new seat is charged now for the rest of the year. If someone leaves, their seat stays paid until renewal and the next person to join takes it for free."
                  : "Seats follow your team. Adding or removing someone changes the next bill. Prices here are before any design partner discount, which shows on your invoices."}
              </p>
            </div>
            {isAdmin && subscribed ? (
              <div className="flex flex-wrap gap-3">
                <form action={openBillingPortalAction}>
                  <button className="btn btn-primary">Manage billing and invoices</button>
                </form>
                {!yearly && (
                  <form action={switchToAnnualAction}>
                    <button className="btn btn-secondary">
                      Switch to yearly, {usd(PLAN.annualSeatPrice)}/mo per seat (save {annualSavingsPct}%)
                    </button>
                    <span className="mt-1 block text-xs text-muted">A design-partner discount is monthly only and ends if you switch.</span>
                  </form>
                )}
              </div>
            ) : isAdmin ? (
              <div className="grid gap-2">
                <div className="flex flex-wrap gap-3">
                  <form action={startCheckoutAction}>
                    <input type="hidden" name="interval" value="year" />
                    <button className="btn btn-primary">Add a card, pay yearly</button>
                  </form>
                  <form action={startCheckoutAction}>
                    <input type="hidden" name="interval" value="month" />
                    <button className="btn btn-secondary">Add a card, pay monthly</button>
                  </form>
                </div>
                <p className="text-sm text-muted">
                  Yearly is {usd(PLAN.annualSeatPrice)} per seat a month, {usd(PLAN.annualSeatPrice * 12)} per seat a year, {annualSavingsPct}% less than
                  monthly at {usd(PLAN.seatPrice)}. Same features and the same {PLAN.includedPerAgent} AI answers per seat each month.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted">Only admins can change billing.</p>
            )}
          </>
        )}
      </section>
      <section id="ai" className="grid scroll-mt-6 gap-4 border-t border-line pt-6">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">
            AI answers
          </h2>
          <p className="text-muted">
            The AI replies to customers by itself, by email and in the chat, when the facts below, your macros or your help articles cover the question. Everything else goes to your team. Each ticket it answers counts as one AI answer, and one it hands to your team doesn&apos;t count.
          </p>
        </div>

        <HowItWorks
          title="How AI answers work"
          open={usage.used === 0}
          summary="Nobody on your team has to click anything. While AI answers are on, the AI reads every new email and chat."
          steps={[
            { title: "A customer writes in", body: "A new email or chat message arrives and becomes a ticket." },
            { title: "The AI checks what it knows", body: "It reads the facts you write below, your macros and your published help articles. If they cover the question, it writes a reply." },
            { title: "It sends the reply on its own", body: "The customer gets it by email or in the chat. The ticket moves to Pending, marked AI answered, and it shows up on your AI receipt." },
            { title: "A person takes over when needed", body: "If the facts don't cover it, the AI isn't sure, or the customer asks for a person, it doesn't reply. The ticket stays open for your team with a note saying why. That doesn't count." },
            { title: "Follow-ups", body: "If the customer writes back, the AI can answer up to 3 follow-ups on the same ticket. Past that, or if it can't answer, the ticket goes back to your team." },
          ]}
          example={
            <>
              a customer emails &quot;What are your opening hours?&quot; and your facts say 9 to 5 on weekdays. The AI replies with the hours and nobody on your
              team has to touch it. Another customer writes &quot;I was charged twice&quot;. Your facts don&apos;t cover that, so the AI leaves it for your team.
            </>
          }
          footnote={
            <>
              AI answers are not the same as AI macros. AI answers reply to customers on their own. <Link href="/app/macros" className="link">AI macros</Link> are saved replies your
              team sends by hand on the tickets the AI leaves to them.
            </>
          }
        />

        <div className="grid gap-2 rounded-xl border border-line bg-surface-2/60 px-4 py-3">
          <p className="flex justify-between gap-2 text-sm">
            <span>{usage.trial ? "Used in your free trial" : "Used this month"}</span>
            <span className="num">
              {Math.min(usage.used, usage.included)} of {usage.included}
              {usage.overage > 0 && ` (+${usage.overage} overage)`}
            </span>
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-line/70" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className={`meter h-full rounded-full ${pct >= 100 ? "bg-warn" : "bg-accent"}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="text-sm text-muted">
            {usage.trial
              ? `${PLAN.trialPerAgent} per agent for the whole trial, shared by the team, plus ${PLAN.trialReviewBonus} for leaving a review on the overview page. Add a card to get the full ${PLAN.includedPerAgent} per agent each month; the first charge still waits until the trial ends.`
              : `${PLAN.includedPerAgent} per agent, shared by the team. Resets on the 1st.`}{" "}
            Admins get an email at 80% and 100%.
          </p>
        </div>

        {!aiConfigured() && <p className="text-sm text-warn">AI isn&apos;t connected on this server yet, so tickets go straight to your team.</p>}

        {org && (
          <form action={saveAiSettingsAction} className="grid gap-4">
            <fieldset disabled={!isAdmin} className="grid gap-4">
              <label className="flex items-center gap-2.5 font-medium">
                <input type="checkbox" name="aiEnabled" defaultChecked={org.aiEnabled} className="size-4 accent-[var(--accent)]" />
                Let the AI reply to new email and chat tickets on its own
              </label>
              <label className="grid gap-1.5">
                <span className="label">What the AI should know</span>
                <span className="text-sm text-muted">
                  Policies, product facts, hours, tone. Your macros are included too, so a good macro library makes a better AI.
                </span>
                <textarea
                  name="aiInstructions"
                  rows={8}
                  defaultValue={org.aiInstructions}
                  placeholder="Example: We ship from Portland within 2 business days. Refunds are handled by the team, never promised by the AI."
                  className="field"
                />
              </label>
              <label className="flex items-start gap-2.5">
                <input type="checkbox" name="aiAutoLearn" defaultChecked={org.aiAutoLearn} className="mt-1 size-4 accent-[var(--accent)]" />
                <span>
                  Let the AI learn from tickets your team solves
                  <span className="block text-sm text-muted">
                    Once a day it reads what your team told customers and saves new facts as saved answers, updates the ones that changed and retires the ones nobody uses. You see every change on the{" "}
                    <Link href="/app/macros#learned" className="link">Macros page</Link>. Included in your plan; it never uses your AI answers.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2.5">
                <input type="checkbox" name="aiTriage" defaultChecked={org.aiTriage} className="mt-1 size-4 accent-[var(--accent)]" />
                <span>
                  Let the AI sort new tickets
                  <span className="block text-sm text-muted">
                    It reads each new ticket and sets its priority, adds tags your team already uses and puts it in a group, before anyone opens it. It only fills in what nobody set, and a note on the ticket says what it changed and why. Included in your plan; it never uses your AI answers.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2.5">
                <input type="checkbox" name="aiOverageEnabled" defaultChecked={org.aiOverageEnabled} className="mt-1 size-4 accent-[var(--accent)]" />
                <span>
                  Keep answering after the allowance is used, at {usd(PLAN.overageRate, true)} per answer
                  <span className="block text-sm text-muted">
                    Off by default. When off, the AI pauses and nothing extra is charged.{usage.trial && " Overage only applies once your team has a card on file."}
                  </span>
                </span>
              </label>
              <label className="grid w-max max-w-full gap-1">
                <span className="label">Monthly overage limit (AI answers, blank for none)</span>
                <input
                  type="number"
                  min={0}
                  max={100000}
                  step={1}
                  name="aiOverageMonthlyLimit"
                  defaultValue={org.aiOverageMonthlyLimit ?? ""}
                  className="field num w-40"
                />
              </label>
              {isAdmin && <button className="btn btn-primary w-max">Save AI settings</button>}
            </fieldset>
            {!isAdmin && <p className="text-sm text-muted">Only admins can change these.</p>}
          </form>
        )}

        <div id="websites" className="grid scroll-mt-6 gap-3 rounded-lg border border-line px-4 py-4 text-sm">
          <div className="grid gap-1">
            <h3 className="font-semibold">Websites the AI reads</h3>
            <p className="text-muted">
              Add your website or docs address and the AI answers from those pages too, beside your macros and help articles, and links customers to them. Flatdesk reads up to {WEB.maxPages} public pages under each address and reads them again every week. No AI answers are used to read them.
            </p>
          </div>
          {typeof webNotice === "string" && <p className="rounded-lg border border-warn/40 bg-surface-2/60 px-3 py-2" role="alert">{webNotice.slice(0, 300)}</p>}
          {sites.length > 0 && (
            <ul className="grid divide-y divide-line border-y border-line">
              {sites.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <span className="grid min-w-0 gap-0.5">
                    <a href={w.url} target="_blank" rel="noreferrer" className="link truncate font-medium">{w.url.replace(/^https?:\/\//, "")}</a>
                    <span className={w.status === "failed" ? "text-warn" : "text-muted"}>
                      {w.status === "reading"
                        ? "Reading the pages now. Refresh in a minute."
                        : w.status === "failed"
                          ? (w.error ?? "Couldn't be read.")
                          : `${w.pageCount} page${w.pageCount === 1 ? "" : "s"}${w.readAt ? `, read ${timeAgo(w.readAt)}` : ""}`}
                    </span>
                  </span>
                  {isAdmin && (
                    <span className="flex gap-2">
                      <form action={readWebSourceAction}>
                        <input type="hidden" name="id" value={w.id} />
                        <button className="btn btn-secondary btn-sm" disabled={w.status === "reading"}>Read again</button>
                      </form>
                      <form action={removeWebSourceAction}>
                        <input type="hidden" name="id" value={w.id} />
                        <button className="btn btn-secondary btn-sm">Remove</button>
                      </form>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {isAdmin && sites.length < WEB.maxSources && (
            <form action={addWebSourceAction} className="flex flex-wrap gap-2">
              <input name="url" required maxLength={2000} placeholder="yourcompany.com/docs" aria-label="Website address" className="field min-w-0 flex-1" />
              <button className="btn btn-secondary">Add website</button>
            </form>
          )}
        </div>
      </section>
      {org && (
        <section id="alerts" className="grid scroll-mt-6 gap-4 border-t border-line pt-6">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold">
              Alerts in Slack or anywhere else
            </h2>
            <p className="text-muted">
              Post to Slack, Discord, Google Chat or any webhook when a new ticket needs your team, or a customer replies after the AI has answered. Nobody has to watch the inbox.
            </p>
          </div>
          {alertsNotice === "sent" && <p className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm" role="status">Test alert sent. Check your channel.</p>}
          {alertsNotice && alertsNotice !== "sent" && <p className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-sm text-warn" role="alert">{alertsNotice}</p>}
          <form action={saveAlertsAction} className="grid gap-4">
            <fieldset disabled={!isAdmin} className="grid gap-4">
              <label className="grid gap-1.5">
                <span className="label">Webhook address</span>
                <span className="text-sm text-muted">
                  In Slack, create an incoming webhook for the channel (Slack&apos;s &quot;Incoming Webhooks&quot; app) and paste its address here.
                  Leave blank to turn alerts off.
                </span>
                {/* The address works as a password for the channel, so only admins see it. */}
                {isAdmin ? (
                  <input type="url" name="alertWebhookUrl" defaultValue={org.alertWebhookUrl ?? ""} placeholder="https://hooks.slack.com/services/…" className="field num text-sm" />
                ) : (
                  <span className="text-sm">{org.alertWebhookUrl ? `Set up by an admin (${webhookLabel(org.alertWebhookUrl)}).` : "Not set up."}</span>
                )}
              </label>
              <div className="grid gap-2">
                <span className="label">Post</span>
                <label className="flex items-start gap-2.5">
                  <input type="radio" name="alertOn" value="team" defaultChecked={org.alertOn !== "all"} className="mt-1 size-4 accent-[var(--accent)]" />
                  <span>
                    Only tickets that need a person
                    <span className="block text-sm text-muted">New tickets the AI didn&apos;t answer, and AI answers the customer wrote back to.</span>
                  </span>
                </label>
                <label className="flex items-start gap-2.5">
                  <input type="radio" name="alertOn" value="all" defaultChecked={org.alertOn === "all"} className="mt-1 size-4 accent-[var(--accent)]" />
                  <span>
                    Every new ticket
                    <span className="block text-sm text-muted">Each one says whether the AI answered it.</span>
                  </span>
                </label>
              </div>
              <div className="grid gap-2">
                <span className="label">Also post when</span>
                {OPTIONAL_EVENTS.map((e) => (
                  <label key={e.id} className="flex items-start gap-2.5">
                    <input type="checkbox" name="alertEvents" value={e.id} defaultChecked={org.alertEvents.includes(e.id)} className="mt-1 size-4 accent-[var(--accent)]" />
                    <span>
                      {e.label}
                      <span className="block text-sm text-muted">{e.hint}</span>
                    </span>
                  </label>
                ))}
                <p className="text-sm text-muted">Tickets set to &ldquo;update the customer every&hellip;&rdquo; always post when an update is due.</p>
              </div>
              {isAdmin && <button className="btn btn-primary w-max">Save alerts</button>}
            </fieldset>
          </form>
          {org.alertWebhookUrl && (
            <div className="grid gap-2 rounded-xl border border-line bg-surface-2/60 px-4 py-3 text-sm">
              <p className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {webhookLabel(org.alertWebhookUrl)}
                  {org.alertLastAt ? (org.alertLastError ? <span className="text-warn">, last alert failed {timeAgo(org.alertLastAt)}: {org.alertLastError}</span> : `, last alert sent ${timeAgo(org.alertLastAt)}`) : ", nothing sent yet"}
                </span>
                {isAdmin && (
                  <form action={sendTestAlertAction}>
                    <button className="btn btn-secondary btn-sm">Send a test alert</button>
                  </form>
                )}
              </p>
              {isAdmin && webhookKind(org.alertWebhookUrl) === "generic" && (
                <p className="text-muted">
                  Your endpoint gets JSON with the event, the ticket and a link. Check it came from Flatdesk with the X-Flatdesk-Signature header:
                  sha256= and the HMAC-SHA256 of the raw body with this secret: <span className="num select-all break-all text-ink">{org.alertSecret}</span>
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {org && (
        <section id="service" className="grid scroll-mt-6 gap-4 border-t border-line pt-6">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold">
              Response target and ratings
            </h2>
            <p className="text-muted">
              New tickets show how long is left for a first reply, turn amber near the target, and are escalated when late. A next-reply target does the same each time a customer writes back, and a resolution target does it for closing the ticket. Reports show how often you hit both.
            </p>
          </div>
          {serviceNotice && <p className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-sm text-warn" role="alert">{serviceNotice}</p>}
          <form action={saveServiceSettingsAction} className="grid gap-4">
            <fieldset disabled={!isAdmin} className="grid gap-4">
              <label className="grid w-max max-w-full gap-1">
                <span className="label">First reply within</span>
                <select name="firstResponseMinutes" defaultValue={String(org.firstResponseMinutes ?? "")} className="field">
                  <option value="">No target</option>
                  {TARGET_CHOICES.map((c) => <option key={c.minutes} value={c.minutes}>{c.label}</option>)}
                </select>
              </label>
              <label className="grid w-max max-w-full gap-1">
                <span className="label">Next reply within</span>
                <select name="nextReplyMinutes" defaultValue={String(org.nextReplyMinutes ?? "")} className="field">
                  <option value="">No target</option>
                  {TARGET_CHOICES.map((c) => <option key={c.minutes} value={c.minutes}>{c.label}</option>)}
                </select>
                <span className="text-sm text-muted">After your first reply, each time the customer writes back, counted from their message.</span>
              </label>
              <label className="grid w-max max-w-full gap-1">
                <span className="label">Resolved (closed) within</span>
                <select name="resolveMinutes" defaultValue={String(org.resolveMinutes ?? "")} className="field">
                  <option value="">No target</option>
                  {RESOLVE_CHOICES.map((c) => <option key={c.minutes} value={c.minutes}>{c.label}</option>)}
                </select>
                <span className="text-sm text-muted">Counted from arrival to closed. A reopened ticket counts again until it&apos;s closed.</span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" name="pauseWhilePending" defaultChecked={org.pauseWhilePending} className="mt-1 size-4 accent-[var(--accent)]" />
                <span className="grid gap-0.5">
                  <span>Pause the resolution clock while a ticket is pending</span>
                  <span className="text-sm text-muted">Time spent waiting on the customer doesn&apos;t count against the resolution target.</span>
                </span>
              </label>
              <fieldset className="grid gap-2">
                <legend className="label mb-1">Different targets by tag</legend>
                <p className="text-sm text-muted">For example vip in 1 hour, or bug-report in 24 hours. A ticket with one of these tags gets that target instead; if it has several, the shortest wins. Tags can come from a trigger.</p>
                {Array.from({ length: 4 }, (_, i) => org.slaPolicies[i]).map((p, i) => (
                  <div key={i} className="flex flex-wrap gap-2">
                    <input name={`policyTag${i}`} defaultValue={p?.tag ?? ""} placeholder={i === 0 ? "vip" : ""} aria-label={`Tag ${i + 1}`} className="field field-sm w-40" />
                    <select name={`policyMinutes${i}`} defaultValue={String(p?.minutes ?? 60)} aria-label={`Target ${i + 1}`} className="field field-sm">
                      {TARGET_CHOICES.map((c) => <option key={c.minutes} value={c.minutes}>first reply within {c.label}</option>)}
                    </select>
                    <select name={`policyResolve${i}`} defaultValue={String(p?.resolveMinutes ?? "")} aria-label={`Resolution target ${i + 1}`} className="field field-sm">
                      <option value="">team resolution target</option>
                      {RESOLVE_CHOICES.map((c) => <option key={c.minutes} value={c.minutes}>resolved within {c.label}</option>)}
                    </select>
                  </div>
                ))}
              </fieldset>
              <label className="grid w-max max-w-full gap-1">
                <span className="label">When a ticket misses it</span>
                <select name="escalateTo" defaultValue={org.escalateTo ?? ""} className="field">
                  <option value="">Tag it overdue and alert, leave it where it is</option>
                  {team.filter((a) => !a.viewer).map((a) => <option key={a.userId} value={a.userId}>Tag it overdue, alert, and hand it to {a.name}</option>)}
                </select>
                <span className="text-sm text-muted">Checked every five minutes. The ticket gets a note, and your alert webhook (Slack or other) gets a message.</span>
              </label>
              <label className="flex items-center gap-2.5">
                <input type="checkbox" name="useBusinessHours" defaultChecked={Boolean(org.businessHours)} className="size-4 accent-[var(--accent)]" />
                Count only business hours
              </label>
              <div className="grid gap-3 rounded-xl border border-line bg-surface-2/60 px-4 py-3">
                <div className="flex flex-wrap gap-3">
                  <label className="grid gap-1">
                    <span className="label">Time zone</span>
                    <select name="tz" defaultValue={hours.tz} className="field field-sm">
                      {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1">
                    <span className="label">Opens</span>
                    <input type="time" name="start" defaultValue={clock(hours.start)} className="field field-sm num" />
                  </label>
                  <label className="grid gap-1">
                    <span className="label">Closes</span>
                    <input type="time" name="end" defaultValue={clock(Math.min(hours.end, 1439))} className="field field-sm num" />
                  </label>
                </div>
                <fieldset className="flex flex-wrap gap-3 text-sm">
                  <legend className="label mb-1">Days</legend>
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
                    <label key={d} className="flex items-center gap-1.5">
                      <input type="checkbox" name="days" value={i} defaultChecked={hours.days.includes(i)} className="size-4 accent-[var(--accent)]" />
                      {d}
                    </label>
                  ))}
                </fieldset>
                <label className="grid gap-1">
                  <span className="label">Closed on these dates (optional)</span>
                  <textarea name="holidays" rows={2} defaultValue={(hours.holidays ?? []).join("\n")} placeholder={"2026-12-25\n2027-01-01"} className="field field-sm num" />
                  <span className="text-sm text-muted">One per line, as year-month-day in the time zone above. Targets skip these days, and the reply for when you&apos;re closed goes out.</span>
                </label>
              </div>
              <label className="grid max-w-xl gap-1">
                <span className="label">Reply outside business hours</span>
                <textarea
                  name="afterHoursMessage"
                  rows={3}
                  maxLength={AFTER_HOURS_MAX}
                  defaultValue={org.afterHoursMessage}
                  placeholder="Thanks for writing. We're offline until 9am Eastern and will reply first thing."
                  className="field"
                />
                <span className="text-sm text-muted">
                  Emailed once to a new email ticket that arrives when you&apos;re closed, if the AI didn&apos;t answer it. Needs business hours above. Leave empty to send nothing.
                </span>
              </label>
              <label className="grid max-w-xl gap-1">
                <span className="label">Acknowledge new emails</span>
                <textarea
                  name="ackMessage"
                  rows={3}
                  maxLength={AFTER_HOURS_MAX}
                  defaultValue={org.ackMessage}
                  placeholder="Thanks for writing. We've opened ticket #{{number}} and will reply soon."
                  className="field"
                />
                <span className="text-sm text-muted">
                  Emailed once to every new email ticket the AI didn&apos;t answer, so customers know it arrived. {"{{number}}"} becomes the ticket number. When you&apos;re closed, the reply above goes instead. Leave empty to send nothing.
                </span>
              </label>
              <label className="flex items-start gap-2.5">
                <input type="checkbox" name="csatEnabled" defaultChecked={org.csatEnabled} className="mt-1 size-4 accent-[var(--accent)]" />
                <span>
                  Ask customers to rate replies
                  <span className="block text-sm text-muted">
                    Every reply email ends with Great, Okay and Not good. One click rates it, and the rating shows on the reply and in Reports. A Not good on an AI answer sends the ticket to your team and it stops counting.
                  </span>
                </span>
              </label>
              {isAdmin && <button className="btn btn-primary w-max">Save</button>}
            </fieldset>
            {!isAdmin && <p className="text-sm text-muted">Only admins can change these.</p>}
          </form>
        </section>
      )}

      <section className="grid gap-4 border-t border-line pt-6">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">
            Team
          </h2>
          <p className="text-muted">
            Viewer seats are free. Viewers can read every ticket and report but can&apos;t reply, change tickets or edit macros. Good for managers and founders who want to look in.
          </p>
        </div>
        <ul className="grid divide-y divide-line">
          {team.map((a) => (
            <li key={a.userId} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <span className="grid min-w-0">
                <span className="truncate font-medium">{a.name}</span>
                <span className="truncate text-sm text-muted">{a.email}</span>
              </span>
              <span className="flex items-center gap-3">
                <span className="text-sm text-muted">{a.role === "admin" ? "Admin, paid seat" : a.viewer ? "Viewer, free" : "Agent, paid seat"}</span>
                {isAdmin && a.role === "agent" && (
                  <form action={setViewerAction}>
                    <input type="hidden" name="userId" value={a.userId} />
                    <input type="hidden" name="viewer" value={String(!a.viewer)} />
                    <button className="btn btn-secondary text-sm">{a.viewer ? "Make agent" : "Make viewer"}</button>
                  </form>
                )}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">Admins always have a paid seat. People you invite show up here after they first sign in.</p>
      </section>
    </div>
  );
}

const SEND_NOTICES: Record<string, string> = {
  saved: "Saved. Add the records below and replies switch over once they're found.",
  removed: "Removed. Replies go out from the shared address again.",
  verified: "It works. Replies now go out from your address.",
  pending: "Not found yet. DNS changes can take up to an hour to show.",
  unchanged: "",
};

// Replies from the team's own address (lib/send-domain.ts).
function SendingAddress({ org, isAdmin, notice }: { org: typeof schema.orgs.$inferSelect; isAdmin: boolean; notice: string | null }) {
  const live = Boolean(org.sendAddress && org.sendDomainVerifiedAt);
  const message = notice === null ? null : (SEND_NOTICES[notice] ?? notice);
  const failed = notice !== null && !(notice in SEND_NOTICES);
  return (
    <div id="sending" className="grid gap-3 rounded-lg border border-line px-4 py-4 text-sm">
      <div className="grid gap-1">
        <h3 className="font-medium">Send from your own address</h3>
        <p className="text-muted">
          Customers see replies from your address, like support@yourcompany.com, instead of {emailConfig.from}. Their answers still come back to Flatdesk.
        </p>
      </div>
      <form action={saveSendAddressAction} className="flex flex-wrap gap-2">
        <label htmlFor="sendAddress" className="sr-only">Your support address</label>
        <input id="sendAddress" name="sendAddress" type="email" defaultValue={org.sendAddress ?? ""} placeholder="support@yourcompany.com" disabled={!isAdmin} maxLength={320} className="field min-w-0 flex-1" />
        {isAdmin && <button className="btn btn-secondary">{org.sendAddress ? "Change" : "Use it"}</button>}
      </form>
      {!isAdmin && <p className="text-muted">Only admins can change it.</p>}
      {message && <p role={failed ? "alert" : undefined} className={failed ? "text-warn" : "text-accent"}>{message}</p>}
      {org.sendAddress && live && <p>Replies go out from <span className="font-medium">{org.sendAddress}</span>.</p>}
      {org.sendAddress && !live && org.sendDomain && (
        <div className="grid gap-3">
          <p>
            {(org.sendDomainRecords ?? []).some((r) => r.status === "verified") ? "Some records are in place. " : ""}
            Add these records where you manage {org.sendDomain}&apos;s DNS. They let Flatdesk sign mail as {org.sendDomain} and don&apos;t change where your own email goes.
          </p>
          <DnsTable rows={org.sendDomainRecords ?? []} />
          <p className="text-muted">
            Names are shown the way most providers want them, without {org.sendDomain} at the end. Until all of them are found, replies keep going out from {emailConfig.from}.
          </p>
          {isAdmin && (
            <form action={checkSendAddressAction}>
              <button className="btn btn-secondary w-max">Check now</button>
            </form>
          )}
        </div>
      )}
      {org.sendAddress && isAdmin && (
        <form action={saveSendAddressAction}>
          <input type="hidden" name="sendAddress" value="" />
          <button className="link w-max text-muted">Stop using {org.sendAddress}</button>
        </form>
      )}
    </div>
  );
}

// A mailbox connected by signing in (lib/mailbox/): mail is read from it and replies sent from it.
function Mailbox({ row, isAdmin, notice }: { row: Awaited<ReturnType<typeof mailboxFor>>; isAdmin: boolean; notice: string | null }) {
  const message = notice === "connected" ? "Connected. New mail in its inbox becomes a ticket within a couple of minutes." : notice === "disconnected" ? "Disconnected. Flatdesk no longer reads or sends from it." : notice;
  const ok = notice === "connected" || notice === "disconnected";
  const kind = row?.kind as MailboxKind | undefined;
  const offered = [gmailConfigured() && { kind: "gmail", label: "Connect Gmail" }, microsoftConfigured() && { kind: "microsoft", label: "Connect Outlook" }].filter(Boolean) as { kind: MailboxKind; label: string }[];
  return (
    <div id="mailbox" className="grid gap-3 rounded-lg border border-line px-4 py-4 text-sm">
      <div className="grid gap-1">
        <h3 className="font-medium">{row && kind ? `${MAILBOX_NAMES[kind]}: ${row.settings.mailbox ?? row.account}` : "Connect your mailbox instead"}</h3>
        <p className="text-muted">
          {row
            ? "Flatdesk reads new mail in this inbox every couple of minutes and turns it into tickets. Replies go out from this mailbox and show in its Sent folder. Nothing in the mailbox is changed or deleted."
            : "Sign in to your Gmail, Google Workspace, Outlook or Microsoft 365 support mailbox instead of setting up forwarding. New mail in the inbox becomes tickets, and replies go out from the mailbox itself. Mail already in the inbox stays where it is."}
        </p>
      </div>
      {message && <p role={ok ? undefined : "alert"} className={ok ? "text-accent" : "text-warn"}>{message}</p>}
      {row?.lastError && <p role="alert" className="text-warn">{row.lastError}</p>}
      {isAdmin ? (
        <div className="flex flex-wrap items-center gap-3">
          {row && kind
            ? row.lastError && <a href={`/api/mailbox/${kind}/connect`} className="btn btn-secondary w-max">Connect again</a>
            : offered.map((o) => (
                <a key={o.kind} href={`/api/mailbox/${o.kind}/connect`} className="btn btn-secondary w-max">{o.label}</a>
              ))}
          {row && (
            <form action={disconnectMailboxAction}>
              <button className="link text-muted">Disconnect</button>
            </form>
          )}
        </div>
      ) : (
        <p className="text-muted">Only admins can change it.</p>
      )}
    </div>
  );
}

// Adds a ticket field, or edits one.
function FieldForm({ field }: { field?: TicketField }) {
  return (
    <form action={saveFieldDefinitionAction} className="grid gap-3 text-sm">
      {field && <input type="hidden" name="id" value={field.id} />}
      <div className="flex flex-wrap gap-3">
        <label className="grid min-w-0 flex-1 gap-1">
          <span className="label">Name</span>
          <input name="name" required maxLength={FIELD_LIMITS.nameChars} defaultValue={field?.name} placeholder="Plan" className="field" />
        </label>
        <label className="grid gap-1">
          <span className="label">Kind</span>
          <select name="kind" defaultValue={field?.kind ?? "text"} className="field">
            {FIELD_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </label>
      </div>
      <label className="grid gap-1">
        <span className="label">Dropdown choices, separated by commas</span>
        <input name="options" defaultValue={field?.options.join(", ")} placeholder="Free, Pro, Business" className="field" />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="requiredToClose" defaultChecked={field?.requiredToClose} className="size-4 accent-[var(--accent)]" />
        Required before closing a ticket
      </label>
      <button className="btn btn-primary w-max">{field ? "Save field" : "Add field"}</button>
    </form>
  );
}
