// Why a flat seat with this much included can cost less without being a
// worse help desk. A low price with a long feature list reads as "cheap", so
// this says where the savings come from, what Flatdesk leaves out, and how a
// team can check the quality on its own tickets before paying. Every line
// must stay true: the model is MODEL in lib/ai.ts, the gaps match compare.ts.

import { TRIAL_DAYS } from "@/lib/billing";
import { PLAN } from "@/lib/pricing";

export const WHY_CHEAPER = [
  {
    title: "Each AI answer costs us a few cents",
    body: `Answers are written by Claude Opus from Anthropic. Each one costs us cents to run, so ${PLAN.includedPerAgent} per seat fit inside the seat price. That's also why the AI stops at the limit instead of charging you more. We don't have to raise everyone's price to pay for one team's busy month.`,
  },
  {
    title: "No sales team to pay for",
    body: "You sign up and pay on your own, so the price doesn't have to cover demos and sales calls.",
  },
  {
    title: "One plan, so nothing is held back",
    body: "Pricing tiers are there to get you onto a bigger plan. With only one plan, every seat gets everything.",
  },
  {
    title: "It does less, on purpose",
    body: "Flatdesk only handles email and chat, for teams of 3 to 15. No phone, no social channels and no app marketplace means a lot less for us to build and run.",
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
  { title: "AI test drive", body: "The AI drafts replies to your last 50 tickets, next to what your team actually sent. Customers don't see them.", href: "/features/ai-test-drive" },
  { title: `${TRIAL_DAYS}-day trial, no card`, body: "Import from your old help desk and keep using it while your team tries Flatdesk on real tickets.", href: "/features/lossless-import" },
  { title: "Refund a wrong AI answer", body: "Every AI answer you're charged for is on the monthly statement. An admin can refund a wrong one with one click.", href: "/features/ai-receipts" },
  { title: "Leave any time", body: "Monthly plans have no contract, and you can export every ticket, customer and macro in one click.", href: "/faq" },
];
