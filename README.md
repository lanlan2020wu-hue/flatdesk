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

Not built yet: attachments, the chat widget, AI answers, Stripe billing, reporting, Zendesk import, data export.

## Running locally

```bash
npm install
# Postgres: any local database works
export DATABASE_URL=postgres://postgres@localhost:5432/flatdesk
npx drizzle-kit migrate
npx tsx scripts/seed.ts        # optional demo data
DEV_AUTH=1 npm run dev         # signs you in as a demo admin without Clerk
```

## Environment variables

| Name | Needed for |
| --- | --- |
| `DATABASE_URL` | Postgres (Neon in production). Without it the waitlist returns 503. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Sign-in and team accounts. Set automatically by the Clerk integration on Vercel. |
| `RESEND_API_KEY` | Sending and receiving email through Resend. |
| `EMAIL_FROM` | Address replies are sent from, on a domain verified in Resend (e.g. `support@mail.flatdesk.app`). |
| `INBOUND_DOMAIN` | Resend receiving domain. Each team's inbox is `<key>@INBOUND_DOMAIN`, shown in Settings. |
| `RESEND_WEBHOOK_SECRET` | Signing secret of the Resend webhook pointing at `/api/inbound/resend` (event `email.received`). |
| `DEV_AUTH` | Local development only. `1` signs in as a demo admin when Clerk keys are missing. Ignored in production. |

## Next up

The chat widget, capped AI resolutions (Claude API), Stripe seat billing, reporting, Zendesk import and one-click export.
