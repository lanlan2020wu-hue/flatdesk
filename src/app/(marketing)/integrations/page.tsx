import Link from "next/link";
import JsonLd from "@/components/JsonLd";
import { TRIAL_DAYS } from "@/lib/billing";
import { breadcrumbs, pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "Integrations: Shopify, Stripe, HubSpot, Jira, Slack, Zapier and the API",
  description: `Flatdesk shows Shopify orders, Stripe subscriptions and HubSpot contacts beside each ticket, sends bugs to Jira, posts to Slack, and connects to Zapier, Make and n8n through its API. All included in every seat. ${TRIAL_DAYS}-day trial.`,
  path: "/integrations",
});

// Only what ships. Each says what it does on a ticket, not that it "integrates".
const ITEMS = [
  {
    name: "Shopify",
    body: "The customer's last five orders beside their ticket: what they bought, the total, payment and delivery status, and tracking links. Matched by email. The AI can read them to answer “where's my order?”, and cancel and refund an order that hasn't shipped if you allow it.",
  },
  {
    name: "Stripe",
    body: "The customer's plan, its status and renewal date, and their last five payments and refunds beside their ticket. Uses a restricted key. With write access you choose to give, the AI can refund a payment or cancel a subscription within limits you set.",
  },
  {
    name: "HubSpot",
    body: "The customer's HubSpot contact beside their ticket: company, title, lifecycle stage, lead status and owner, with a link to the record. Read only.",
  },
  {
    name: "Jira",
    body: "Turn a bug report into a Jira issue from the ticket, with the customer's words and a link back. The ticket shows the issue's status, so you know when it's fixed.",
  },
  {
    name: "Slack, Discord and Google Chat",
    body: "A post in your channel when a new ticket needs a person, or a customer writes back to an AI answer, with a link to the ticket.",
  },
  {
    name: "Zapier, Make and n8n",
    body: "Start a workflow when a ticket comes in, or make a ticket from a form, a failed payment or an order problem in another app.",
  },
  {
    name: "Your own system, through AI actions",
    body: "Give the AI actions that call your endpoint: reset a password, change a plan, look up an account. Each call is signed, and you choose which ones a person approves first.",
  },
  {
    name: "REST API and webhooks",
    body: "List, create, update and reply to tickets, and look up customers, with an API key. New tickets can post signed JSON to any address.",
  },
  {
    name: "Import from your help desk",
    body: "Tickets, customers, macros, tags and rules from Zendesk, Intercom, Freshdesk or Help Scout, with every original record kept.",
  },
];

export default function IntegrationsPage() {
  return (
    <div className="mx-auto grid max-w-6xl gap-14 px-4 pt-14 sm:px-6 sm:pt-20">
      <JsonLd data={[breadcrumbs([{ name: "Integrations", path: "/integrations" }])]} />
      <section className="grid max-w-3xl gap-5">
        <h1 style={{ "--d": 1 } as React.CSSProperties} className="enter font-display text-[2.6rem] sm:text-6xl">Integrations</h1>
        <p style={{ "--d": 2 } as React.CSSProperties} className="enter text-lg text-muted">
          The customer&apos;s orders, payments and CRM record next to their ticket, bugs sent to Jira, alerts where your team already talks, and an API for the rest. Included in every seat, like everything else.
        </p>
      </section>

      <ul data-play="" suppressHydrationWarning className="grid gap-x-10 gap-y-8 md:grid-cols-2">
        {ITEMS.map((it, i) => (
          <li key={it.name} style={{ "--i": i } as React.CSSProperties} className="ln grid content-start gap-2 border-t border-line pt-4">
            <h2 className="text-lg font-semibold">{it.name}</h2>
            <p className="text-muted">{it.body}</p>
          </li>
        ))}
      </ul>

      <section className="grid max-w-3xl gap-3 border-t border-line pt-6">
        <h2 className="text-lg font-semibold">Not yet</h2>
        <p className="text-muted">
          There&apos;s no app marketplace, and no replying to customers from inside Slack. If you need either today, a bigger suite fits better. Anything with a webhook or an API can reach Flatdesk through Zapier, Make or n8n.
        </p>
        <p className="flex flex-wrap gap-4 text-sm">
          <Link href="/developers" className="link font-medium text-accent">API reference</Link>
          <Link href="/sign-up" className="link font-medium text-accent">Start your free trial</Link>
        </p>
      </section>
    </div>
  );
}
