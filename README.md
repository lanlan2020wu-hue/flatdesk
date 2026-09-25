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
- Import (`/app/import`, `src/lib/import`): Zendesk, Intercom (Fin), Freshdesk and Help Scout, over their APIs. Tickets with full conversation history, macros and saved replies, tags, rules, custom fields, contacts, companies and agents. Every raw record is stored in `import_records`, so nothing is lost; what doesn't map is listed in a report (downloadable as CSV) and every original field stays on the ticket. Imports run in short resumable steps driven by the import page, pause on rate limits, and can be re-run without duplicating anything. Agents are matched by email, and tickets and tag rules for agents who haven't joined yet follow them when they do.
- Onboarding (`/app/welcome`): a five-step checklist for new teams: create the team, invite agents (suggesting the ones found in an import), connect the support inbox (with Gmail's forwarding code shown when it arrives), import from the old tool, and send a real test email through forwarding, or a sample ticket.

Not built yet: attachments (imported ones are linked, not copied).

## Running locally

```bash
npm install
# Postgres: any local database works
export DATABASE_URL=postgres://postgres@localhost:5432/flatdesk
npm run db:migrate
npx tsx scripts/seed.ts        # optional demo data
DEV_AUTH=1 npm run dev         # signs you in as a demo admin without Clerk
npx tsx scripts/demo-import.ts zendesk   # optional: a sample import from recorded API responses
npm test                       # import and onboarding tests; point DATABASE_URL at a scratch database
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
| `IMPORT_SECRET` | Optional. Key for encrypting help desk API keys while an import runs (erased when it ends). Falls back to `CLERK_SECRET_KEY`. |
| `STRIPE_SECRET_KEY` | Billing. Set by the Stripe integration on Vercel. |
| `CRON_SECRET` | Authorizes Vercel Cron's call to `/api/cron/daily`. |
| `DEV_AUTH` | Local development only. `1` signs in as a demo admin when Clerk keys are missing. Ignored in production. |

## Next up

Attachments on email and chat tickets, and copying imported attachments.
