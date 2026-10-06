import Link from "next/link";
import { eq } from "drizzle-orm";
import { HubSpotForm, JiraForm, NewKeyForm, ShopifyForm, StripeForm } from "@/components/IntegrationForms";
import { db, schema } from "@/db";
import { listApiKeys } from "@/lib/api-keys";
import { webhookLabel } from "@/lib/alerts";
import { requireOpenPage } from "@/lib/auth";
import { timeAgo } from "@/lib/format";
import { listIntegrations, type Integration } from "@/lib/integrations";
import { SITE } from "@/lib/site";
import { disconnectAction, revokeKeyAction } from "./actions";

export const metadata = { title: "Integrations" };

function Connected({ row, label }: { row: Integration; label: string }) {
  return (
    <div className="grid gap-1 rounded-xl border border-line bg-surface-2/60 px-4 py-3 text-sm">
      <p>
        Connected to <span className="font-medium">{row.account}</span> {timeAgo(row.createdAt)}.
      </p>
      {row.lastError && row.lastErrorAt && (
        <p className="text-warn">
          The last lookup failed {timeAgo(row.lastErrorAt)}: {row.lastError}
        </p>
      )}
      <p className="text-muted">{label}</p>
    </div>
  );
}

function Disconnect({ kind }: { kind: "shopify" | "stripe" | "hubspot" | "jira" }) {
  return (
    <form action={disconnectAction}>
      <input type="hidden" name="kind" value={kind} />
      <button className="btn btn-secondary btn-sm">Disconnect</button>
    </form>
  );
}

export default async function IntegrationsPage() {
  const s = await requireOpenPage();
  const isAdmin = s.role === "admin";
  const [connected, keys, org] = await Promise.all([
    listIntegrations(s.orgId),
    isAdmin ? listApiKeys(s.orgId) : [],
    db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId) }),
  ]);
  const adminsOnly = !isAdmin && <p className="text-sm text-muted">Only admins can connect or change this.</p>;

  return (
    <div className="grid max-w-2xl gap-10 px-4 py-6 md:px-8 md:py-8">
      <div className="grid gap-2">
        <h1 className="page-title">Integrations</h1>
        <p className="text-muted">See a customer&apos;s orders, payments and CRM record next to their ticket, send bugs to Jira, get alerts in Slack, and connect Flatdesk to the rest of your tools.</p>
      </div>

      <section id="shopify" className="grid scroll-mt-6 gap-4 border-t border-line pt-6">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">Shopify</h2>
          <p className="text-muted">
            Each ticket shows the customer&apos;s last five orders, matched by email: what they bought, the total, whether it&apos;s paid and shipped, and tracking links.
            Answer &quot;where&apos;s my order?&quot; without opening Shopify.
          </p>
        </div>
        {connected.shopify && <Connected row={connected.shopify} label="Orders show on every ticket from a customer with orders in this store." />}
        {isAdmin ? (
          <>
            <details className="text-sm text-muted" open={!connected.shopify}>
              <summary className="cursor-pointer font-medium text-ink">How to get these from Shopify</summary>
              <ol className="mt-2 grid list-decimal gap-1 pl-5">
                <li>In Shopify, open Settings, then Apps, then Develop apps, and follow the link to the Dev Dashboard.</li>
                <li>Create an app named Flatdesk. In its version settings, add the Admin API scopes <span className="num">read_orders</span> and <span className="num">read_customers</span> (and <span className="num">read_all_orders</span> to see orders older than 60 days). Release the version.</li>
                <li>Install the app on your store, then copy the client ID and client secret from the app&apos;s settings.</li>
              </ol>
              <p className="mt-2">Flatdesk only reads orders and customers. The secret is stored encrypted.</p>
            </details>
            <ShopifyForm connected={Boolean(connected.shopify)} />
            {connected.shopify && <Disconnect kind="shopify" />}
          </>
        ) : (
          !connected.shopify && adminsOnly
        )}
      </section>

      <section id="stripe" className="grid scroll-mt-6 gap-4 border-t border-line pt-6">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">Stripe</h2>
          <p className="text-muted">
            For software and subscription businesses. Each ticket shows the customer&apos;s plan, its status and renewal date, and their last five payments and refunds.
            Answer &quot;why was I charged?&quot; without opening Stripe.
          </p>
        </div>
        {connected.stripe && <Connected row={connected.stripe} label="Subscriptions and payments show on every ticket from a customer in this Stripe account." />}
        {isAdmin ? (
          <>
            <details className="text-sm text-muted" open={!connected.stripe}>
              <summary className="cursor-pointer font-medium text-ink">How to make a restricted key</summary>
              <ol className="mt-2 grid list-decimal gap-1 pl-5">
                <li>In Stripe, open Developers, then API keys, and choose Create restricted key.</li>
                <li>Name it Flatdesk. Set Customers, Subscriptions and Charges to Read. Leave everything else at None.</li>
                <li>Create the key and paste it here.</li>
              </ol>
              <p className="mt-2">A restricted key can only read what you allow, so Flatdesk can&apos;t charge, refund or change anything. It&apos;s stored encrypted.</p>
            </details>
            <StripeForm connected={Boolean(connected.stripe)} />
            {connected.stripe && <Disconnect kind="stripe" />}
          </>
        ) : (
          !connected.stripe && adminsOnly
        )}
      </section>

      <section id="hubspot" className="grid scroll-mt-6 gap-4 border-t border-line pt-6">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">HubSpot</h2>
          <p className="text-muted">Each ticket shows the customer&apos;s HubSpot contact: company, title, lifecycle stage, lead status and owner, with a link to the record.</p>
        </div>
        {connected.hubspot && <Connected row={connected.hubspot} label="Contacts show on every ticket from someone in this HubSpot account." />}
        {isAdmin ? (
          <>
            <details className="text-sm text-muted" open={!connected.hubspot}>
              <summary className="cursor-pointer font-medium text-ink">How to get a token from HubSpot</summary>
              <ol className="mt-2 grid list-decimal gap-1 pl-5">
                <li>In HubSpot, open Settings, then Integrations, then Private Apps (Legacy Apps in newer accounts), and create an app named Flatdesk.</li>
                <li>Under Scopes, add <span className="num">crm.objects.contacts.read</span>. Add <span className="num">crm.objects.companies.read</span> and <span className="num">crm.objects.owners.read</span> to show the company and owner too.</li>
                <li>Create the app and copy its access token.</li>
              </ol>
              <p className="mt-2">These scopes only read. The token is stored encrypted.</p>
            </details>
            <HubSpotForm connected={Boolean(connected.hubspot)} />
            {connected.hubspot && <Disconnect kind="hubspot" />}
          </>
        ) : (
          !connected.hubspot && adminsOnly
        )}
      </section>

      <section id="jira" className="grid scroll-mt-6 gap-4 border-t border-line pt-6">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">Jira</h2>
          <p className="text-muted">
            Turn a bug report into a Jira issue from the ticket, with the customer&apos;s words and a link back. The ticket shows the issue&apos;s status, so you know when to tell the customer it&apos;s fixed.
          </p>
        </div>
        {connected.jira && <Connected row={connected.jira} label="Agents see Send to Jira on every ticket." />}
        {isAdmin ? (
          <>
            <details className="text-sm text-muted" open={!connected.jira}>
              <summary className="cursor-pointer font-medium text-ink">How to connect Jira Cloud</summary>
              <ol className="mt-2 grid list-decimal gap-1 pl-5">
                <li>Pick the Jira account issues should come from. A shared account like support@ works well.</li>
                <li>Signed in as that account, make an API token at id.atlassian.com, under Security, API tokens.</li>
                <li>Enter the project key (the letters in its issue keys, like SUP) and the issue type to use, like Bug or Task.</li>
              </ol>
              <p className="mt-2">Issues are created as that account, labeled flatdesk. The token is stored encrypted.</p>
            </details>
            <JiraForm connected={Boolean(connected.jira)} />
            {connected.jira && <Disconnect kind="jira" />}
          </>
        ) : (
          !connected.jira && adminsOnly
        )}
      </section>

      <section id="slack" className="grid scroll-mt-6 gap-3 border-t border-line pt-6">
        <h2 className="text-lg font-semibold">Slack, Discord and Google Chat</h2>
        <p className="text-muted">
          A post in your team&apos;s channel when a new ticket needs a person, or a customer writes back to an AI answer, with a link to the ticket.
        </p>
        <p className="text-sm">
          {org?.alertWebhookUrl ? `On, posting to ${webhookLabel(org.alertWebhookUrl)}. ` : "Not set up. "}
          <Link href="/app/settings#alerts" className="link text-accent">{org?.alertWebhookUrl ? "Change alerts" : "Set up alerts"}</Link>
        </p>
      </section>

      <section id="zapier" className="grid scroll-mt-6 gap-3 border-t border-line pt-6">
        <h2 className="text-lg font-semibold">Zapier, Make and n8n</h2>
        <p className="text-muted">Connect Flatdesk to thousands of other apps with the API key below and the webhook alerts.</p>
        <ul className="grid list-disc gap-1.5 pl-5 text-sm text-muted">
          <li>
            <span className="text-ink">When a ticket comes in, do something:</span> in Zapier, start a Zap with Webhooks by Zapier, Catch Hook. Paste its address into{" "}
            <Link href="/app/settings#alerts" className="link text-accent">alerts</Link> and choose Every new ticket. Each new ticket arrives as JSON with the customer, subject and a link.
          </li>
          <li>
            <span className="text-ink">Make a ticket from another app</span> (a form, a failed payment, an order problem): add a Webhooks by Zapier, POST step to <span className="num">{SITE.url}/api/v1/tickets</span> with the header <span className="num">Authorization: Bearer</span> and your key.
          </li>
          <li>
            <span className="text-ink">Look up, reply to or close tickets</span> from a script or another tool with the same key.
          </li>
        </ul>
        <p className="text-sm">
          <Link href="/developers" className="link text-accent">Read the API reference</Link>
        </p>
      </section>

      <section id="api" className="grid scroll-mt-6 gap-4 border-t border-line pt-6">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">API keys</h2>
          <p className="text-muted">
            A key can read every ticket, make new ones and reply as anyone on the team, so treat it like a password. Replies sent with a key are signed by whoever made it, unless the request names someone else.
          </p>
        </div>
        {isAdmin ? (
          <>
            <NewKeyForm />
            {keys.length > 0 && (
              <ul className="grid divide-y divide-line rounded-xl border border-line text-sm">
                {keys.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <span className="grid gap-0.5">
                      <span className="font-medium">{k.name}</span>
                      <span className="text-muted">
                        <span className="num">{k.prefix}…</span> · made {timeAgo(k.createdAt)} · {k.lastUsedAt ? `last used ${timeAgo(k.lastUsedAt)}` : "never used"}
                      </span>
                    </span>
                    <form action={revokeKeyAction}>
                      <input type="hidden" name="id" value={k.id} />
                      <button className="btn btn-secondary btn-sm">Revoke</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          adminsOnly
        )}
      </section>
    </div>
  );
}
