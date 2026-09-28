import Link from "next/link";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { aiConfigured, aiUsage } from "@/lib/ai";
import { access, billingConfigured, isActive, refreshSubscription, seatCount, trialEndsAt } from "@/lib/billing";
import { emailConfig, inboundAddress } from "@/lib/email";
import { PLAN, annualSavingsPct, usd } from "@/lib/pricing";
import { openBillingPortalAction, saveAiSettingsAction, startCheckoutAction, switchToAnnualAction } from "../actions";

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
  const { billing } = await searchParams;
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

  return (
    <div className="grid max-w-2xl gap-6 px-4 py-6 md:px-8 md:py-8">
      <h1 className="font-display text-3xl">Settings</h1>
      <section className="card grid gap-3 p-5 sm:p-6">
        <h2 className="flex items-center gap-2 font-medium">
          <svg viewBox="0 0 24 24" className="size-8 rounded-lg bg-accent-soft p-1.5 text-accent" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h16v12H4zM4 7l8 6 8-6" /></svg>
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
        <section className="card grid gap-3 p-5 sm:p-6">
          <h2 className="font-medium">Website chat</h2>
          <p className="text-muted">
            Paste this before the closing &lt;/body&gt; tag of your website. Visitors get a chat button; their messages become chat tickets
            here, and your replies reach them in the chat and by email.
          </p>
          <pre className="num overflow-x-auto rounded-lg border border-dashed border-accent/40 bg-accent-soft px-3 py-2 text-sm select-all">
            {`<script src="${siteOrigin}/widget.js" data-key="${org.widgetKey}" async></script>`}
          </pre>
          <p className="text-sm text-muted">
            <a href={`/chat/${org.widgetKey}`} target="_blank" className="link text-accent">Open the chat window</a> to try it.
          </p>
        </section>
      )}

      <section className="card grid gap-3 p-5 sm:p-6">
        <h2 className="font-medium">Export</h2>
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

      <section id="billing" className="card grid scroll-mt-6 gap-3 p-5 sm:p-6">
        <h2 className="font-medium">Plan and billing</h2>
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
              <p className="text-sm text-muted">Seats follow your team members: adding or removing someone updates the next bill.</p>
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
                  monthly at {usd(PLAN.seatPrice)}. Same features and the same {PLAN.includedPerAgent} AI resolutions per seat each month.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted">Only admins can change billing.</p>
            )}
          </>
        )}
      </section>
      <section className="card grid gap-4 p-5 sm:p-6">
        <div className="grid gap-1">
          <h2 className="flex items-center gap-2 font-medium">
            <svg viewBox="0 0 24 24" className="size-8 rounded-lg bg-accent-soft p-1.5 text-accent" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.6L18.5 9l-4.7 1.6L12 15l-1.8-4.4L5.5 9l4.7-1.4zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z" /></svg>
            AI answers
          </h2>
          <p className="text-muted">
            The AI answers new email and chat tickets when your notes or macros cover the question, and hands everything else to your team. An
            answer counts toward the allowance only if the customer doesn&apos;t write back.
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
                  Keep answering after the allowance is used, at {usd(PLAN.overageRate, true)} per resolution
                  <span className="block text-sm text-muted">
                    Off by default. When off, the AI pauses and nothing extra is charged.{usage.trial && " Overage only applies once your team has a card on file."}
                  </span>
                </span>
              </label>
              <label className="grid w-max gap-1">
                <span className="label">Monthly overage limit (resolutions, blank for none)</span>
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
    </div>
  );
}
