// Questions buyers (and AI answer engines) ask, with answers that stand on
// their own. Selling-point questions live with each point in selling-points.ts.

import { TRIAL_DAYS } from "@/lib/billing";
import { PLAN, usd } from "@/lib/pricing";
import type { QA } from "@/lib/selling-points";

export const GENERAL_FAQ: QA[] = [
  {
    q: "What is Flatdesk?",
    a: `Flatdesk is a help desk for support teams of about 5 to 20 agents. Email and website chat land in one shared inbox, AI answers routine questions from your own macros, and the price is ${usd(PLAN.seatPrice)} per agent per month with AI included and capped.`,
  },
  {
    q: "Which channels does Flatdesk support?",
    a: "Email (forward your support address) and a website chat widget you add with one script tag. Both become tickets in the same inbox. Phone, SMS and social channels aren't supported.",
  },
  {
    q: "Does Flatdesk have a help center or knowledge base?",
    a: "Not yet. The AI answers from your macros and internal notes.",
  },
  {
    q: "Who is Flatdesk a good fit for?",
    a: "Email and chat support teams that use AI for a real share of tickets and want the bill to stay the same every month, especially teams coming from per-resolution AI pricing.",
  },
];

export const BILLING_FAQ: QA[] = [
  {
    q: "Is there a free trial?",
    a: `Yes, ${TRIAL_DAYS} days with every feature and no card, including ${PLAN.trialPerAgent} AI resolutions per agent for the trial. Add a card at any point to get the full ${PLAN.includedPerAgent} per agent a month; the first charge still waits until the trial ends.`,
  },
  {
    q: "What counts as an AI resolution?",
    a: "A conversation the AI answers where the customer doesn't ask for a person afterwards. Conversations the AI hands to your team don't count. Each conversation counts at most once.",
  },
  {
    q: "What happens when we use all the included resolutions?",
    a: "The AI stops answering for the rest of the month and new conversations go to your team as normal tickets. Nothing is charged. You get an email when you reach 80% and again at 100%.",
  },
  {
    q: "How does overage work?",
    a: `Only an admin can turn it on, from billing settings. Each resolution past the included amount then costs ${usd(PLAN.overageRate, true)}. You can set a monthly limit, and you can turn overage off at any time.`,
  },
  {
    q: "Are the resolutions per agent or per team?",
    a: `Per team. A 10-agent team gets ${(PLAN.includedPerAgent * 10).toLocaleString("en-US")} a month to share, however the tickets fall.`,
  },
  {
    q: "Is there a contract or a minimum?",
    a: "No. Billing is monthly, you can add or remove seats at any time, and you can cancel from settings.",
  },
  {
    q: "Can we take our data with us?",
    a: "Yes. Settings has a one-click export of all tickets, customers, tags and macros as CSV or JSON. You never need to ask us for it.",
  },
];
