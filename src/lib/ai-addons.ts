// What other help desks charge for AI help with replies and macros, next to
// Flatdesk where it's in the seat. Every figure was read from the vendor's own
// pricing page or help article on ADDONS_CHECKED_ON; keep each one sourced.
// Gorgias isn't listed: it doesn't publish a macro or reply AI add-on price.

import { PLAN, competitorById, usd } from "@/lib/pricing";

export const ADDONS_CHECKED_ON = "2026-09-30";

// Example team for the "extra a month" column.
export const ADDON_TEAM = 10;

export type AddOn = {
  vendor: string;
  // What the vendor calls the AI that suggests or drafts replies and macros.
  feature: string;
  // How you get it and what it costs, in the vendor's own terms.
  price: string;
  // Extra per agent per month over the same vendor's cheapest seat, or null when included.
  perAgent: number | null;
  sources: { label: string; url: string }[];
};

const helpScoutStep = competitorById("helpscout-plus").seatPrice - competitorById("helpscout-standard").seatPrice;

export const ADDONS: AddOn[] = [
  {
    vendor: "Zendesk",
    feature: "Copilot add-on: macro suggestions from common replies",
    price: "$50 per agent a month, billed yearly, on top of Suite from $55",
    perAgent: 50,
    sources: [
      { label: "Zendesk pricing", url: "https://www.zendesk.com/pricing/" },
      { label: "Zendesk: macro suggestions (Copilot add-on)", url: "https://support.zendesk.com/hc/en-us/articles/5217191091354" },
    ],
  },
  {
    vendor: "Freshdesk",
    feature: "Freddy AI Copilot: canned response suggester and reply drafts",
    price: "$29 per agent a month, sold with Pro ($55) and Enterprise only",
    perAgent: 29,
    sources: [
      { label: "Freshdesk pricing", url: "https://www.freshworks.com/freshdesk/pricing/" },
      { label: "Freshdesk: Freddy AI for ticketing", url: "https://support.freshdesk.com/support/solutions/articles/50000010359-overview-of-freddy-ai-for-ticketing" },
    ],
  },
  {
    vendor: "Intercom",
    feature: "Copilot: suggests macros as replies",
    price: "$29 per agent a month after 10 free Copilot conversations per agent",
    perAgent: 29,
    sources: [
      { label: "Intercom pricing", url: "https://www.intercom.com/pricing" },
      { label: "Intercom: how to use Copilot", url: "https://www.intercom.com/help/en/articles/8587194-how-to-use-fin-ai-copilot" },
    ],
  },
  {
    vendor: "Front",
    feature: "Copilot add-on: drafts and refines replies",
    price: "$20 per seat a month, or included in Enterprise ($105)",
    perAgent: 20,
    sources: [
      { label: "Front pricing", url: "https://front.com/pricing" },
      { label: "Front: Copilot", url: "https://help.front.com/en/articles/4848832" },
    ],
  },
  {
    vendor: "Help Scout",
    feature: "AI Drafts: replies drafted from past conversations",
    price: `Plus plan and up, $45 per user a month instead of $25 on Standard`,
    perAgent: helpScoutStep,
    sources: [{ label: "Help Scout pricing", url: "https://www.helpscout.com/pricing/" }],
  },
];

export const FLATDESK_ADDON = {
  vendor: "Flatdesk",
  feature: "AI macros from your team's replies, kept up to date from its edits, plus AI answers",
  price: `Included in every seat, ${usd(PLAN.seatPrice)} a month or ${usd(PLAN.annualSeatPrice)} billed yearly. Macros never use the AI allowance`,
  perAgent: null,
};
