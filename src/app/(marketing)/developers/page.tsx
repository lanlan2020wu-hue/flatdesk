import Link from "next/link";
import JsonLd from "@/components/JsonLd";
import { ENDPOINTS, WEBHOOK_EXAMPLE } from "@/lib/api-docs";
import { breadcrumbs, pageMeta } from "@/lib/seo";
import { SITE } from "@/lib/site";

export const metadata = pageMeta({
  title: "Flatdesk API reference",
  description: "The Flatdesk REST API: list, create, update and reply to tickets, look up customers, and get signed webhooks for new tickets. Works with Zapier, Make and n8n.",
  path: "/developers",
});

const code = "num overflow-x-auto rounded-lg border border-line bg-surface px-3 py-2 text-sm";

export default function DevelopersPage() {
  return (
    <div className="mx-auto grid max-w-3xl gap-14 px-4 pt-14 sm:px-6 sm:pt-20">
      <JsonLd data={[breadcrumbs([{ name: "API reference", path: "/developers" }])]} />

      <section className="grid gap-4">
        <h1 className="font-display text-[2.4rem] sm:text-5xl">API reference</h1>
        <p className="text-lg text-muted">
          Read and change tickets from your own code, Zapier, Make or n8n. Every plan includes the API. There are no extra charges for using it.
        </p>
      </section>

      <section className="grid gap-3" aria-labelledby="auth">
        <h2 id="auth" className="font-display text-2xl">Authentication</h2>
        <p className="text-muted">
          An admin makes a key in Flatdesk under Integrations. Send it in the Authorization header. Requests and responses are JSON. A key can make up to 1,000 requests an hour.
        </p>
        <pre className={code}>{`curl ${SITE.url}/api/v1/tickets?status=open \\
  -H "Authorization: Bearer fd_your_key"`}</pre>
        <p className="text-sm text-muted">
          Errors come back as <span className="num">{`{ "error": "..." }`}</span> with a status code: 400 for a bad field, 401 for a missing or revoked key, 402 when the trial ended without a card (reading still works), 404, and 429 when you go too fast.
        </p>
      </section>

      <section className="grid gap-6" aria-labelledby="endpoints">
        <h2 id="endpoints" className="font-display text-2xl">Endpoints</h2>
        {ENDPOINTS.map((e) => (
          <article key={`${e.method} ${e.path}`} className="grid gap-2 border-b border-line pb-6">
            <h3 className="num flex flex-wrap items-baseline gap-2 font-medium">
              <span className="chip">{e.method}</span>
              {e.path}
            </h3>
            <p className="text-muted">{e.summary}</p>
            {e.params && (
              <dl className="grid gap-1 text-sm sm:grid-cols-[10rem_1fr]">
                {e.params.map((p) => (
                  <div key={p.name} className="contents">
                    <dt className="num">{p.name}</dt>
                    <dd className="text-muted">{p.about}</dd>
                  </div>
                ))}
              </dl>
            )}
            {e.example && <pre className={code}>{e.example}</pre>}
          </article>
        ))}
        <p className="text-sm text-muted">
          Tickets come back with number, subject, status, channel, tags, customer, assignee, answered_by_ai, url and timestamps. A ticket&apos;s messages have author_type (customer, agent, ai or system), author_name, body, internal and created_at.
        </p>
      </section>

      <section className="grid gap-3" aria-labelledby="webhooks">
        <h2 id="webhooks" className="font-display text-2xl">Webhooks</h2>
        <p className="text-muted">
          Set a webhook address under Settings, Alerts, and choose which tickets to send: only the ones that need a person, or every new one. Slack, Discord and Google Chat
          addresses get a message in their own format. Any other address gets JSON like this, with event ticket.created or ticket.handed_back (a customer wrote back to an AI answer):
        </p>
        <pre className={code}>{WEBHOOK_EXAMPLE}</pre>
        <p className="text-sm text-muted">
          Check it came from Flatdesk with the <span className="num">X-Flatdesk-Signature</span> header: <span className="num">sha256=</span> followed by the HMAC-SHA256 of the raw body, keyed with the secret shown under Alerts.
        </p>
      </section>

      <section className="grid gap-3" aria-labelledby="zapier">
        <h2 id="zapier" className="font-display text-2xl">Zapier, Make and n8n</h2>
        <ul className="grid list-disc gap-2 pl-5 text-muted">
          <li>To start a Zap when a ticket comes in, use Webhooks by Zapier, Catch Hook, and paste its address as your webhook in Flatdesk.</li>
          <li>To make a ticket from another app, add a Webhooks by Zapier, POST step to <span className="num">/api/v1/tickets</span> with your key in the Authorization header.</li>
          <li>To catch every change, poll <span className="num">/api/v1/tickets?updated_since=</span> with the newest updated_at you&apos;ve seen.</li>
        </ul>
        <p className="text-sm">
          <Link href="/integrations" className="link text-accent">All integrations</Link>
        </p>
      </section>
    </div>
  );
}
