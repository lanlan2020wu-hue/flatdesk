// Every number here is shown to visitors. Keep each one traceable to a
// source URL, and update CHECKED_ON whenever competitor figures are re-checked.

export const CHECKED_ON = "2026-09-25";

export const PLAN = {
  name: "Flatdesk",
  seatPrice: 49, // USD per agent per month
  includedPerAgent: 100, // AI resolutions per agent per month, pooled across the team
  overageRate: 0.4, // USD per extra AI resolution, only when an admin turns overage on
} as const;

export type Competitor = {
  id: string;
  vendor: string;
  plan: string;
  seatPrice: number; // USD per agent per month
  billing: "annual" | "monthly";
  aiRate: number; // USD per AI resolution beyond what's included
  included: number; // AI resolutions included
  includedPer: "agent" | "account";
  estimated: boolean; // true when the vendor does not publish the AI rate
  aiNote: string;
  sources: { label: string; url: string }[];
};

const ZENDESK_SOURCES = [
  { label: "Zendesk pricing", url: "https://www.zendesk.com/pricing/" },
  {
    label: "Zendesk: automated overage billing from Jan 1, 2026",
    url: "https://support.zendesk.com/hc/en-us/articles/9908811576858",
  },
  {
    label: "Richpanel: Zendesk AI resolution rates (third party)",
    url: "https://www.richpanel.com/learn/zendesk-pricing",
  },
];

const FIN_SOURCES = [
  { label: "Macha: Fin pricing 2026 (third party)", url: "https://www.getmacha.com/blog/intercom-fin-pricing" },
  { label: "Intercom pricing", url: "https://www.intercom.com/pricing" },
];

export const COMPETITORS: Competitor[] = [
  {
    id: "zendesk-team",
    vendor: "Zendesk",
    plan: "Suite Team",
    seatPrice: 55,
    billing: "annual",
    aiRate: 1.5,
    included: 10,
    includedPer: "agent",
    estimated: true,
    aiNote:
      "Zendesk doesn't publish its per-resolution rate. Third-party reports put it near $1.50 committed and $2.00 pay-as-you-go, with about 5–15 included per agent.",
    sources: ZENDESK_SOURCES,
  },
  {
    id: "zendesk-professional",
    vendor: "Zendesk",
    plan: "Suite Professional",
    seatPrice: 115,
    billing: "annual",
    aiRate: 1.5,
    included: 10,
    includedPer: "agent",
    estimated: true,
    aiNote:
      "Zendesk doesn't publish its per-resolution rate. Third-party reports put it near $1.50 committed and $2.00 pay-as-you-go, with about 5–15 included per agent.",
    sources: ZENDESK_SOURCES,
  },
  {
    id: "fin-essential",
    vendor: "Fin (formerly Intercom)",
    plan: "Essential",
    seatPrice: 29,
    billing: "annual",
    aiRate: 0.99,
    included: 0,
    includedPer: "account",
    estimated: false,
    aiNote: "$0.99 per Fin outcome, with no volume discount.",
    sources: FIN_SOURCES,
  },
  {
    id: "fin-advanced",
    vendor: "Fin (formerly Intercom)",
    plan: "Advanced",
    seatPrice: 85,
    billing: "annual",
    aiRate: 0.99,
    included: 0,
    includedPer: "account",
    estimated: false,
    aiNote: "$0.99 per Fin outcome, with no volume discount.",
    sources: FIN_SOURCES,
  },
  {
    id: "fin-expert",
    vendor: "Fin (formerly Intercom)",
    plan: "Expert",
    seatPrice: 132,
    billing: "annual",
    aiRate: 0.99,
    included: 0,
    includedPer: "account",
    estimated: false,
    aiNote: "$0.99 per Fin outcome, with no volume discount.",
    sources: FIN_SOURCES,
  },
  {
    id: "freshdesk-pro",
    vendor: "Freshdesk",
    plan: "Pro",
    seatPrice: 55,
    billing: "annual",
    aiRate: 0.49,
    included: 500,
    includedPer: "account",
    estimated: false,
    aiNote: "500 AI Agent sessions included, then $49 per pack of 100. Freshdesk bills sessions, which are not the same as resolutions.",
    sources: [{ label: "Drag: Freshdesk pricing 2026 (third party)", url: "https://www.dragapp.com/blog/freshdesk-pricing/" }],
  },
  {
    id: "helpscout-plus",
    vendor: "Help Scout",
    plan: "Plus",
    seatPrice: 45,
    billing: "monthly",
    aiRate: 0.75,
    included: 0,
    includedPer: "account",
    estimated: false,
    aiNote: "$0.75 per AI resolution. Help Scout lets admins set a monthly spending cap.",
    sources: [
      { label: "Help Scout pricing", url: "https://www.helpscout.com/pricing/" },
      { label: "Help Scout: AI resolutions pricing", url: "https://docs.helpscout.com/article/1746-ai-resolutions-pricing" },
    ],
  },
];

export function competitorById(id: string): Competitor {
  return COMPETITORS.find((c) => c.id === id) ?? COMPETITORS[3];
}

export function competitorMonthly(c: Competitor, agents: number, resolutions: number, aiRate = c.aiRate) {
  const included = c.includedPer === "agent" ? c.included * agents : c.included;
  const seats = c.seatPrice * agents;
  const ai = Math.max(0, resolutions - included) * aiRate;
  return { seats, ai, total: seats + ai, included };
}

export function flatdeskMonthly(agents: number, resolutions: number) {
  const included = PLAN.includedPerAgent * agents;
  const seats = PLAN.seatPrice * agents;
  const extra = Math.max(0, resolutions - included);
  return {
    seats,
    included,
    extra,
    capped: seats, // AI pauses at the cap; extra tickets go to your team
    withOverage: seats + extra * PLAN.overageRate,
  };
}

export const usd = (n: number, cents = false) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
