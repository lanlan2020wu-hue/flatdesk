# Flatdesk

A help desk for 5–20 agent support teams with one flat price: $49 per agent per month, 100 AI resolutions per agent included and capped by default.

## What's here

The public marketing site, built first so it can collect leads while the app is built:

- `/` landing page and waitlist
- `/calculator` bill calculator comparing Zendesk, Fin (Intercom), Freshdesk and Help Scout with Flatdesk (shareable URL)
- `/pricing` public pricing page
- `/ai-billing-changes-2026` sourced timeline of 2026 AI billing changes

All prices live in `src/lib/pricing.ts`. Every competitor number there must have a source, and `CHECKED_ON` must be updated whenever they are re-checked.

## Running locally

```bash
npm install
npm run dev
```

## Environment variables

| Name | Needed for |
| --- | --- |
| `DATABASE_URL` | Waitlist signups (Neon Postgres). Without it the waitlist returns 503. |

## Next up

The app itself: org signup (Clerk), shared inbox, macros, capped AI resolutions (Claude API), Stripe seat billing, reporting, Zendesk import and one-click export.
