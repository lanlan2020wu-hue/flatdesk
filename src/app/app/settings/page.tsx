import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { aiConfigured, aiUsage } from "@/lib/ai";
import { billingConfigured, isActive, refreshSubscription, seatCount, TRIAL_DAYS } from "@/lib/billing";
import { emailConfig, inboundAddress } from "@/lib/email";
import { PLAN, usd } from "@/lib/pricing";
import { openBillingPortalAction, saveAiSettingsAction, startCheckoutAction } from "../actions";

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
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const siteOrigin = `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
  const address = org ? inboundAddress(org.inboundKey) : null;
  const usage = await aiUsage(s.orgId);
  const pct = Math.min(100, Math.round((usage.used / usage.included) * 100));
  const isAdmin = s.role === "admin";

  return (
    <div className="grid max-w-2xl gap-8 px-4 py-6 md:px-8">
      <h1 className="font-display text-2xl">Settings</h1>
      <section className="grid gap-2">
        <h2 className="font-medium">Email</h2>
        {address ? (
          <>
            <p className="text-muted">
              Forward your support address (for example support@yourcompany.com) to this address. Every email that arrives becomes a
              ticket, and customer replies land on the same ticket.
            </p>
            <p className="num w-max max-w-full select-all break-all rounded-md border border-line bg-surface px-3 py-2">{address}</p>
            <p className="text-sm text-muted">
              Replies to customers are sent from {emailConfig.from} under your team&apos;s name, {org?.name}.
            </p>
          </>
        ) : (
          <p className="text-muted">Email isn&apos;t connected on this server yet.</p>
        )}
      </section>

      {org && (
        <section className="grid gap-2">
          <h2 className="font-medium">Website chat</h2>
          <p className="text-muted">
            Paste this before the closing &lt;/body&gt; tag of your website. Visitors get a chat button; their messages become chat tickets
            here, and your replies reach them in the chat and by email.
          </p>
          <pre className="num overflow-x-auto rounded-md border border-line bg-surface px-3 py-2 text-sm select-all">
            {`<script src="${siteOrigin}/widget.js" data-key="${org.widgetKey}" async></script>`}
          </pre>
          <p className="text-sm text-muted">
            <a href={`/chat/${org.widgetKey}`} target="_blank" className="underline">Open the chat window</a> to try it.
          </p>
        </section>
      )}

      <section className="grid gap-2">
        <h2 className="font-medium">Export</h2>
        <p className="text-muted">
          Your data is yours. Download it any time, no need to ask us. Moving from Zendesk?{" "}
          <a href="/app/import" className="underline">Import your tickets</a>.
        </p>
        <ul className="grid gap-1 text-sm">
          {(["tickets", "messages", "customers", "macros"] as const).map((t) => (
            <li key={t} className="flex gap-3">
              <span className="w-24 capitalize">{t}</span>
              <a href={`/app/export?type=${t}`} className="underline">CSV</a>
              <a href={`/app/export?type=${t}&format=json`} className="underline">JSON</a>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-3">
        <h2 className="font-medium">Plan and billing</h2>
        {billing === "done" && <p className="rounded-md bg-accent-soft px-3 py-2 text-sm">Thanks, your plan is set up.</p>}
        {!billingConfigured() ? (
          <p className="text-muted">Billing isn&apos;t connected on this server yet.</p>
        ) : (
          <>
            <div className="grid gap-1 rounded-lg border border-line bg-surface px-4 py-3">
              <p className="flex justify-between gap-2">
                <span>{subscribed ? STATUS_TEXT[org?.subscriptionStatus ?? ""] ?? org?.subscriptionStatus : "No plan yet"}</span>
                <span className="num">
                  {seats} {seats === 1 ? "seat" : "seats"} × {usd(PLAN.seatPrice)} = {usd(seats * PLAN.seatPrice)}/mo
                </span>
              </p>
              {subscribed && org?.currentPeriodEnd && (
                <p className="text-sm text-muted">
                  {org.subscriptionStatus === "trialing" ? "Trial ends" : "Renews"}{" "}
                  {org.currentPeriodEnd.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </p>
              )}
              <p className="text-sm text-muted">Seats follow your team members: adding or removing someone updates the next bill.</p>
            </div>
            {isAdmin ? (
              <form action={subscribed ? openBillingPortalAction : startCheckoutAction}>
                <button className="rounded-md bg-accent px-4 py-2 text-accent-ink">
                  {subscribed ? "Manage billing and invoices" : `Start ${TRIAL_DAYS}-day free trial`}
                </button>
              </form>
            ) : (
              <p className="text-sm text-muted">Only admins can change billing.</p>
            )}
          </>
        )}
      </section>

      <section className="grid gap-4">
        <div className="grid gap-1">
          <h2 className="font-medium">AI answers</h2>
          <p className="text-muted">
            The AI answers new email and chat tickets when your notes or macros cover the question, and hands everything else to your team. An
            answer counts toward the allowance only if the customer doesn&apos;t write back.
          </p>
        </div>

        <div className="grid gap-2 rounded-lg border border-line bg-surface px-4 py-3">
          <p className="flex justify-between gap-2 text-sm">
            <span>Used this month</span>
            <span className="num">
              {Math.min(usage.used, usage.included)} of {usage.included}
              {usage.overage > 0 && ` (+${usage.overage} overage)`}
            </span>
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full ${pct >= 100 ? "bg-warn" : "bg-accent"}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="text-sm text-muted">
            {PLAN.includedPerAgent} per agent, shared by the team. Resets on the 1st. Admins get an email at 80% and 100%.
          </p>
        </div>

        {!aiConfigured() && <p className="text-sm text-warn">AI isn&apos;t connected on this server yet, so tickets go straight to your team.</p>}

        {org && (
          <form action={saveAiSettingsAction} className="grid gap-4">
            <fieldset disabled={!isAdmin} className="grid gap-4">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="aiEnabled" defaultChecked={org.aiEnabled} />
                Let the AI answer new email and chat tickets
              </label>
              <label className="grid gap-1">
                <span>What the AI should know</span>
                <span className="text-sm text-muted">
                  Policies, product facts, hours, tone. Your macros are included too, so a good macro library makes a better AI.
                </span>
                <textarea
                  name="aiInstructions"
                  rows={8}
                  defaultValue={org.aiInstructions}
                  placeholder="Example: We ship from Portland within 2 business days. Refunds are handled by the team, never promised by the AI."
                  className="rounded-md border border-line bg-surface px-3 py-2"
                />
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" name="aiOverageEnabled" defaultChecked={org.aiOverageEnabled} className="mt-1" />
                <span>
                  Keep answering after the allowance is used, at {usd(PLAN.overageRate, true)} per resolution
                  <span className="block text-sm text-muted">Off by default. When off, the AI pauses and nothing extra is charged.</span>
                </span>
              </label>
              <label className="grid w-max gap-1">
                <span className="text-sm">Monthly overage limit (resolutions, blank for none)</span>
                <input
                  type="number"
                  min={0}
                  name="aiOverageMonthlyLimit"
                  defaultValue={org.aiOverageMonthlyLimit ?? ""}
                  className="num w-40 rounded-md border border-line bg-surface px-3 py-2"
                />
              </label>
              {isAdmin && <button className="w-max rounded-md bg-accent px-4 py-2 text-accent-ink">Save AI settings</button>}
            </fieldset>
            {!isAdmin && <p className="text-sm text-muted">Only admins can change these.</p>}
          </form>
        )}
      </section>
    </div>
  );
}
