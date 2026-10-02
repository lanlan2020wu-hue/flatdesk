import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { aiConfigured, aiUsage } from "@/lib/ai";
import { access, billingConfigured, isActive, refreshSubscription, seatCount, trialEndsAt } from "@/lib/billing";
import { emailConfig, inboundAddress } from "@/lib/email";
import { PLAN, annualSavingsPct, usd } from "@/lib/pricing";
import { webhookKind, webhookLabel } from "@/lib/alerts";
import { DEFAULT_HOURS, TARGET_CHOICES } from "@/lib/sla";
import { timeAgo } from "@/lib/format";
import {
  openBillingPortalAction,
  saveAiSettingsAction,
  saveAlertsAction,
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
  const { billing, alerts: alertsNotice, service: serviceNotice } = await searchParams;
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
  const usage = await aiUsage(s.orgId);
  const pct = Math.min(100, Math.round((usage.used / usage.included) * 100));
  const isAdmin = s.role === "admin";
  const yearly = subscribed && org?.billingInterval === "year";
  const hours = org?.businessHours ?? DEFAULT_HOURS;
  const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const zones = Intl.supportedValuesOf("timeZone");
  const team = await db.select().from(schema.agents).where(eq(schema.agents.orgId, s.orgId)).orderBy(asc(schema.agents.name));

  return (
    <div className="grid max-w-2xl gap-10 px-4 py-6 md:px-8 md:py-8">
      <h1 className="page-title">Settings</h1>
      <section className="grid gap-3 border-t border-line pt-6">
        <h2 className="text-lg font-semibold">
          Email
        </h2>
        {address ? (
          <>
            <p className="text-muted">
              Forward your support address (for example support@yourcompany.com) to this address. Every email that arrives becomes a
              ticket, and customer replies land on the same ticket.
            </p>
            <p className="num w-max max-w-full select-all break-all rounded-lg border border-dashed border-accent/40 bg-accent-soft px-3 py-2 text-sm">{address}</p>
            <p className="text-sm text-muted">
              Replies to customers are sent from {emailConfig.from} under your team&apos;s name, {org?.name}.
            </p>
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
        </section>
      )}

      <section className="grid gap-3 border-t border-line pt-6">
        <h2 className="text-lg font-semibold">Export</h2>
        <p className="text-muted">
          Your data is yours. Download it any time, no need to ask us. Moving from another help desk?{" "}
          <Link href="/app/import" className="link text-accent">Import everything</Link>.
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
      <section className="grid gap-4 border-t border-line pt-6">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">
            AI answers
          </h2>
          <p className="text-muted">
            The AI answers new email and chat tickets when your notes or macros cover the question, and hands the rest to your team. It answers up to 3 follow-ups on a ticket. Each ticket counts once, and not at all if the AI hands it over.
          </p>
        </div>

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
              ? `${PLAN.trialPerAgent} per agent for the whole trial, shared by the team. Add a card to get the full ${PLAN.includedPerAgent} per agent each month; the first charge still waits until the trial ends.`
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
                Let the AI answer new email and chat tickets
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
                <input type="checkbox" name="aiOverageEnabled" defaultChecked={org.aiOverageEnabled} className="mt-1 size-4 accent-[var(--accent)]" />
                <span>
                  Keep answering after the allowance is used, at {usd(PLAN.overageRate, true)} per answer
                  <span className="block text-sm text-muted">
                    Off by default. When off, the AI pauses and nothing extra is charged.{usage.trial && " Overage only applies once your team has a card on file."}
                  </span>
                </span>
              </label>
              <label className="grid w-max gap-1">
                <span className="label">Monthly overage limit (AI answers, blank for none)</span>
                <input
                  type="number"
                  min={0}
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
      </section>
      {org && (
        <section id="alerts" className="grid scroll-mt-6 gap-4 border-t border-line pt-6">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold">
              Alerts in Slack or anywhere else
            </h2>
            <p className="text-muted">
              Post to Slack, Discord, Google Chat or any webhook when a new ticket needs your team, or a customer writes back to an AI answer. Nobody has to watch the inbox.
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
                <input type="url" name="alertWebhookUrl" defaultValue={org.alertWebhookUrl ?? ""} placeholder="https://hooks.slack.com/services/…" className="field num text-sm" />
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
              New tickets show how long is left for a first reply, turn amber near the target, and get flagged when late. Reports show how often you hit it.
            </p>
          </div>
          {serviceNotice && <p className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-sm text-warn" role="alert">{serviceNotice}</p>}
          <form action={saveServiceSettingsAction} className="grid gap-4">
            <fieldset disabled={!isAdmin} className="grid gap-4">
              <label className="grid w-max gap-1">
                <span className="label">First reply within</span>
                <select name="firstResponseMinutes" defaultValue={String(org.firstResponseMinutes ?? "")} className="field">
                  <option value="">No target</option>
                  {TARGET_CHOICES.map((c) => <option key={c.minutes} value={c.minutes}>{c.label}</option>)}
                </select>
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
              </div>
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
