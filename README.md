# Flatdesk

A help desk for 5–20 agent support teams with one flat price: $49 per agent per month, 100 AI resolutions per agent included and capped by default.

## What's here

The public marketing site, built first so it can collect leads while the app is built:

- `/` landing page and waitlist
- `/calculator` bill calculator comparing Zendesk, Fin (Intercom), Freshdesk and Help Scout with Flatdesk (shareable URL)
- `/pricing` public pricing page
- `/ai-billing-changes-2026` sourced timeline of 2026 AI billing changes

All prices live in `src/lib/pricing.ts`. Every competitor number there must have a source, and `CHECKED_ON` must be updated whenever they are re-checked.

## The app (`/app`)

- Shared inbox with views (assigned to me, unassigned, open, pending, closed)
- Ticket view: replies, internal notes, status, assignee, tags
- Macros (saved replies that can add tags and set status) and tag-based assignment rules
- Team accounts via Clerk organizations; each member is a seat

- Email: incoming mail creates tickets or threads onto existing ones; agent replies are emailed to the customer
- AI answers (`src/lib/ai.ts`): Claude answers the first message of new email tickets when the team's notes or macros cover it, and hands off otherwise. An answer counts as a resolution unless the customer writes back. The team allowance is capped (the AI pauses) unless an admin turns on overage, and admins get an email at 80% and 100%. Settings shows usage.

- Billing (`src/lib/billing.ts`): Stripe Checkout starts a 14-day trial of a per-seat subscription; seats follow Clerk membership; the customer portal handles cards and invoices. A daily Vercel Cron job (`/api/cron/daily`) refreshes subscriptions, fixes seat counts and adds last month's AI overage to the next invoice, once.

- Website chat: `public/widget.js` adds a chat button to any site (`data-key` = the team's widget key, shown in Settings with the embed code). It opens `/chat/<key>` in an iframe; messages become chat tickets, the AI can answer them, and team replies show in the chat and are emailed too.
- Export (`/app/export`): tickets, messages, customers and macros as CSV or JSON.

- Reports (`/app/reports`): new tickets by channel, median first response and close times, AI-answered share, and a per-agent table, over 7, 30 or 90 days.
- Zendesk import (`/app/import`, `src/lib/zendesk.ts`): an admin enters their Zendesk subdomain, email and an API token (used once, never stored). Tickets, replies and internal notes come over with their dates, status and tags; re-running skips tickets already imported (`externalId` = `zendesk:<id>`) and continues a run that hit the time limit. Nothing is emailed and the AI skips imported tickets.

Not built yet: attachments.

## Running locally

```bash
npm install
# Postgres: any local database works
export DATABASE_URL=postgres://postgres@localhost:5432/flatdesk
npm run db:migrate
npx tsx scripts/seed.ts        # optional demo data
DEV_AUTH=1 npm run dev         # signs you in as a demo admin without Clerk
```

## Environment variables

| Name | Needed for |
| --- | --- |
| `DATABASE_URL` | Postgres (Neon in production). Without it the waitlist returns 503. Production builds apply migrations first (`scripts/migrate.mjs`). |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Sign-in and team accounts. Set automatically by the Clerk integration on Vercel. |
| `RESEND_API_KEY` | Sending and receiving email through Resend. |
| `EMAIL_FROM` | Address replies are sent from, on a domain verified in Resend (e.g. `support@mail.flatdesk.app`). |
| `INBOUND_DOMAIN` | Resend receiving domain. Each team's inbox is `<key>@INBOUND_DOMAIN`, shown in Settings. |
| `RESEND_WEBHOOK_SECRET` | Signing secret of the Resend webhook pointing at `/api/inbound/resend` (event `email.received`). |
| `ANTHROPIC_API_KEY` | AI answers. Without it every ticket goes to the team. |
| `STRIPE_SECRET_KEY` | Billing. Set by the Stripe integration on Vercel. |
| `CRON_SECRET` | Authorizes Vercel Cron's call to `/api/cron/daily`. |
| `ZENDESK_API_URL` | Tests only. Points the Zendesk import at a local fake instead of `<subdomain>.zendesk.com`. |
| `DEV_AUTH` | Local development only. `1` signs in as a demo admin when Clerk keys are missing. Ignored in production. |

## Next up

Attachments on email and chat tickets, and importing Zendesk attachments.
