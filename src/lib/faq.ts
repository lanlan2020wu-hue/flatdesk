// Questions buyers (and AI answer engines) ask, with answers that stand on
// their own. Selling-point questions live with each point in selling-points.ts.

import { TRIAL_DAYS } from "@/lib/billing";
import { SITE } from "@/lib/site";
import { PLAN, PRICE_PHRASE, annualSavingsPct, usd } from "@/lib/pricing";
import type { QA } from "@/lib/selling-points";

export const GENERAL_FAQ: QA[] = [
  {
    q: "What is Flatdesk?",
    a: `Flatdesk is a help desk for support teams of 3 to 15 agents. Email and website chat land in one inbox, and the AI answers routine questions from your macros. It costs ${PRICE_PHRASE}, with AI included and capped.`,
  },
  {
    q: "What do ticket, agent and macro mean?",
    a: "A ticket is one customer conversation, by email or chat. An agent is a person on your team who answers tickets, and each agent is a paid seat. A macro is a saved reply an agent sends with one click instead of typing it again. Flatdesk's AI writes macros for you from the answers your team keeps retyping.",
  },
  {
    q: "Does the AI answer customers by itself?",
    a: "Yes. When a new email or chat comes in, the AI replies on its own if your facts, macros or help articles cover the question. If they don't, it isn't sure, or the customer asks for a person, it leaves the ticket for your team with a note saying why. An admin can turn this off in Settings.",
  },
  {
    q: "What's the difference between AI answers and AI macros?",
    a: "AI answers reply to customers by themselves, with nobody on your team involved, and each one counts toward the AI answers in your plan. AI macros help your team with the tickets the AI leaves to them: Flatdesk finds replies your team keeps retyping and the AI writes them up as saved replies your team sends with one click. AI macros don't use AI answers.",
  },
  {
    q: "Which channels does Flatdesk support?",
    a: "Email (forward your support address) and a website chat widget you add with one script tag. Both become tickets in the same inbox. Phone, SMS and social channels aren't supported.",
  },
  {
    q: "Does Flatdesk have a help center or knowledge base?",
    a: "Yes, a simple one. Every team gets a public help center with search and writes articles in the app. The AI answers from them and links customers to the right one. Articles can be grouped into sections. Importing from Zendesk brings your Guide articles and sections over (drafts stay drafts). There are no languages or custom domains yet, and articles from Intercom, Freshdesk and Help Scout aren't imported yet.",
  },
  {
    q: "How can we tell if the AI is good enough before we pay?",
    a: "Run the AI test drive during your trial. After you import your help desk, the AI drafts answers to the 50 most recent tickets your team answered and shows each one beside the reply your team sent. Nothing goes to customers and it doesn't use your AI allowance.",
  },
  {
    q: "How is this much included in one flat price? Is it a worse help desk?",
    a: `It costs less because of what Flatdesk leaves out, not because the parts you use are worse. AI answers are written by Claude Opus from Anthropic. One answer costs cents to run, so ${PLAN.includedPerAgent} per seat fit in the seat price, and the cap keeps it that way. There's no sales team and only one plan. The product is narrower too: email and chat only, with no phone, SMS, social channels or app marketplace. Before you pay, the AI test drive shows drafts for the last 50 tickets your team answered, beside its real replies, and the ${TRIAL_DAYS}-day trial has every feature.`,
  },
  {
    q: "Who is behind Flatdesk, and how new is it?",
    a: `Flatdesk is new. It opened to paying teams in October 2026, so there are no customer logos or reviews on this site, and we'd rather show none than invent them. There's no sales or support staff, so you reach the person who runs it and wrote the code at ${SITE.contactEmail}. The About page has the details.`,
  },
  {
    q: "What happens to our data if Flatdesk shuts down?",
    a: "The terms commit us to at least 90 days' notice by email to every admin, with the app and the full export (attachments included) working for all of that time and no new charges after the notice. Your data is then deleted, not sold. You can also export everything yourself, any time, from Settings.",
  },
  {
    q: "What can't Flatdesk do yet?",
    a: "No phone, SMS or social channels, no app marketplace, no SSO, no SOC 2 or ISO 27001 report, no independent penetration test, no uptime commitment and no choice of data region. The security page lists these first, on purpose.",
  },
  {
    q: "Can we send a security questionnaire before we try it?",
    a: `Yes. Email ${SITE.contactEmail} and we'll fill it in, and where the answer is no it says no. You can also try Flatdesk with the AI switched off and with test tickets instead of real data. Steps are on the security page.`,
  },
  {
    q: "Who is Flatdesk a good fit for?",
    a: "Email and chat teams that want AI to handle a real share of tickets and want the same bill every month. Especially teams tired of paying per AI answer.",
  },
];

export const BILLING_FAQ: QA[] = [
  {
    q: "Is there a free trial?",
    a: `Yes, ${TRIAL_DAYS} days with every feature and no card, including ${PLAN.trialPerAgent} AI answers per agent for the trial (up to ${PLAN.trialPerAgent * PLAN.trialAgentCap} for the team). Leave an honest review during the trial, any rating, and the team gets ${PLAN.trialReviewBonus} more. Add a card any time to get the full ${PLAN.includedPerAgent} per agent a month. The first charge is when the trial ends, or 2 days after you add the card if that's later.`,
  },
  {
    q: "Can viewers see tickets without paying for a seat?",
    a: "Yes. An admin can make any member who isn't an admin a viewer in Settings. Viewers can read every ticket and report but can't reply or change anything, and they aren't billed.",
  },
  {
    q: "What counts as an AI answer?",
    a: "A conversation the AI finishes without your team. Other help desks call this a resolution. The AI can answer up to 3 follow-ups in the same conversation and it still counts once. If it hands the conversation to your team, including when the customer asks for a person, it doesn't count.",
  },
  {
    q: "What happens when we use all the included resolutions?",
    a: "The AI stops for the rest of the month and new conversations go to your team as normal tickets. You aren't charged. You get an email at 80% and at 100%.",
  },
  {
    q: "How does overage work?",
    a: `Only an admin can turn it on, in Settings under AI answers. Each answer past the included amount then costs ${usd(PLAN.overageRate, true)}. You can set a monthly limit and turn it off any time.`,
  },
  {
    q: "Are the resolutions per agent or per team?",
    a: `Per team. A team of 10 agents gets ${(PLAN.includedPerAgent * 10).toLocaleString("en-US")} a month to share.`,
  },
  {
    q: "Is there a contract or a minimum?",
    a: "No. Monthly billing has no contract. Add or remove seats any time and cancel in Settings. Yearly billing is paid a year ahead for the lower price and runs to the end of that year. If someone leaves mid-year, their seat stays paid until renewal and the next person you add takes it for free.",
  },
  {
    q: "Is there a discount for paying yearly?",
    a: `Yes. Yearly billing is ${usd(PLAN.annualSeatPrice)} per agent per month, ${annualSavingsPct}% less than ${usd(PLAN.seatPrice)} month to month, charged as ${usd(PLAN.annualSeatPrice * 12)} per agent for the year. Same features, same ${PLAN.includedPerAgent} AI answers per agent a month. Seats added during the year are charged for the rest of it. Overage, if you turn it on, is billed monthly.`,
  },
  {
    q: "Can we take our data with us?",
    a: "Yes. Settings has one download with everything: tickets, messages, customers, macros, help articles, the audit log, and every attachment as its original file, in a .zip. Each table is also available on its own as CSV or JSON. You never have to ask us.",
  },
];
