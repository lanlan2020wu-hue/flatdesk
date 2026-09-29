// Questions buyers (and AI answer engines) ask, with answers that stand on
// their own. Selling-point questions live with each point in selling-points.ts.

import { SWITCH_TRIAL_DAYS, TRIAL_DAYS } from "@/lib/billing";
import { PLAN, PRICE_PHRASE, annualSavingsPct, usd } from "@/lib/pricing";
import type { QA } from "@/lib/selling-points";

export const GENERAL_FAQ: QA[] = [
  {
    q: "What is Flatdesk?",
    a: `Flatdesk is a help desk for support teams of about 3 to 15 agents. Email and website chat land in one shared inbox, AI answers routine questions from your own macros, and the price is ${PRICE_PHRASE}, with AI included and capped.`,
  },
  {
    q: "Which channels does Flatdesk support?",
    a: "Email (forward your support address) and a website chat widget you add with one script tag. Both become tickets in the same inbox. Phone, SMS and social channels aren't supported.",
  },
  {
    q: "Does Flatdesk have a help center or knowledge base?",
    a: "Yes, a simple one. Every team gets a public help center with search and writes its articles in the app. The AI answers from published articles as well as your macros, and links the customer to the right article. It doesn't have categories, multiple languages or a custom domain yet, and articles from your old help desk aren't imported.",
  },
  {
    q: "How can we tell if the AI is good enough before we pay?",
    a: "Run the AI test drive during your free trial. After you import your help desk, the AI drafts answers to your 50 most recent tickets using your macros, and shows each draft beside the reply your team actually sent. Nothing is sent to customers and it doesn't use your AI allowance.",
  },
  {
    q: "Who is Flatdesk a good fit for?",
    a: "Email and chat support teams that use AI for a real share of tickets and want the bill to stay the same every month, especially teams coming from per-resolution AI pricing.",
  },
];

export const BILLING_FAQ: QA[] = [
  {
    q: "Is there a free trial?",
    a: `Yes, ${TRIAL_DAYS} days with every feature and no card, including ${PLAN.trialPerAgent} AI resolutions per agent for the trial. Add a card at any point to get the full ${PLAN.includedPerAgent} per agent a month; the first charge still waits until the trial ends. Import your old help desk during the trial and it runs ${SWITCH_TRIAL_DAYS} days instead.`,
  },
  {
    q: "Do we get longer to try Flatdesk if we're switching?",
    a: `Yes. When an import of your tickets from Zendesk, Intercom, Freshdesk or Help Scout finishes during the free trial, the trial runs ${SWITCH_TRIAL_DAYS} days from sign-up instead of ${TRIAL_DAYS}, so moving over doesn't use it up. Your old help desk can keep running alongside until you're ready.`,
  },
  {
    q: "Can viewers see tickets without paying for a seat?",
    a: "Yes. An admin can make any non-admin member a viewer in Settings. Viewers read every ticket and report but can't reply or change anything, and they aren't billed.",
  },
  {
    q: "What counts as an AI resolution?",
    a: "A conversation the AI finishes without your team. If the customer writes back, the AI answers up to 3 follow-ups in the same conversation, still as one resolution. If it hands the conversation to your team at any point, including when the customer asks for a person, it stops counting. Each conversation counts at most once.",
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
    a: "No. Monthly billing has no contract: add or remove seats at any time and cancel from settings. Yearly billing is paid a year ahead for the lower price and runs to the end of the year you've paid for.",
  },
  {
    q: "Is there a discount for paying yearly?",
    a: `Yes. Yearly billing is ${usd(PLAN.annualSeatPrice)} per agent per month, ${annualSavingsPct}% less than ${usd(PLAN.seatPrice)} month to month, charged as ${usd(PLAN.annualSeatPrice * 12)} per agent for the year. You get the same features and the same ${PLAN.includedPerAgent} AI resolutions per agent every month. Seats added mid-year are charged for the rest of the year; overage, if you turn it on, is billed monthly.`,
  },
  {
    q: "Can we take our data with us?",
    a: "Yes. Settings has a one-click export of all tickets, customers, tags and macros as CSV or JSON. You never need to ask us for it.",
  },
];
