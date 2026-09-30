// Why a flat seat with this much included can cost less without being a
// worse help desk. A low price with a long feature list reads as "cheap", so
// this says where the savings come from, what Flatdesk leaves out, and how a
// team can check the quality on its own tickets before paying. Every line
// must stay true: the model is MODEL in lib/ai.ts, the gaps match compare.ts.

import { SWITCH_TRIAL_DAYS } from "@/lib/billing";
import { PLAN } from "@/lib/pricing";

export const WHY_CHEAPER = [
  {
    title: "The AI costs cents, and the cap keeps it there",
    body: `Answers are written by Claude Opus from Anthropic. One answer costs us cents to run, so ${PLAN.includedPerAgent} a seat fit inside the seat price. The cap is why the AI pauses instead of billing you: it keeps one team's busy month from being priced into everyone's seat.`,
  },
  {
    title: "No sales team to pay for",
    body: "You sign up, import and pay on your own. There are no demos, account executives or quote calls built into the price.",
  },
  {
    title: "One plan, so nothing is held back to sell later",
    body: "Tiers exist to move you up a plan. With one plan there's nothing to gate, so every seat gets the whole product.",
  },
  {
    title: "A narrower help desk, built for small teams",
    body: "Email and chat for teams of 3 to 15. Fewer channels and no marketplace means fewer things to build, and more time on the ones you use.",
  },
];

// What Flatdesk doesn't do. Saying it plainly is part of the quality case.
export const LEFT_OUT = [
  "Phone, SMS, WhatsApp and social channels",
  "An app marketplace",
  "Full SLA policies with escalations (first-reply targets only)",
  "A help center in several languages or on your own domain",
  "Shopify order data in the ticket",
];

// Ways to judge the quality before the first charge.
export const CHECK_IT = [
  { title: "AI test drive", body: "The AI drafts answers to your last 50 tickets, shown beside what your team actually sent. Nothing goes to customers.", href: "/features/ai-test-drive" },
  { title: `${SWITCH_TRIAL_DAYS}-day trial when you switch`, body: "Import your old help desk and keep it running alongside while your team tries Flatdesk on real tickets.", href: "/features/lossless-import" },
  { title: "Refund a wrong AI answer", body: "Every counted answer is on the monthly receipt. If one was wrong, an admin refunds it in one click.", href: "/features/ai-receipts" },
  { title: "Leave any time", body: "Monthly billing has no contract, and a one-click export takes every ticket, customer and macro with you.", href: "/faq" },
];
