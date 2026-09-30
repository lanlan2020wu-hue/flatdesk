// A feature grid: AI macro features down the side of each help desk, with
// what it costs to get each one (null = not offered). Every figure was read
// from the vendor's own pricing page or help article on ADDONS_CHECKED_ON;
// keep each one sourced. Gorgias isn't listed: it publishes no macro AI price.

import { PLAN, competitorById, usd } from "@/lib/pricing";

export const ADDONS_CHECKED_ON = "2026-09-30";

export const FEATURES = [
  "Writes new macros from repeated replies",
  "Updates macros from your team's edits",
  "Suggests the right macro while replying",
  "AI answers to customers",
] as const;

export type GridRow = {
  vendor: string;
  // One cell per FEATURES entry: the price to get it, or null when it isn't offered.
  cells: (string | null)[];
  note?: string;
};

const each = (id: string) => {
  const c = competitorById(id);
  return `${c.estimated ? "~" : ""}${usd(c.aiRate, true)} each`;
};

// Flatdesk's equivalent per-answer rate: the whole seat price spread over its included answers.
export const perAnswer = (billing: "month" | "year") =>
  (billing === "year" ? PLAN.annualSeatPrice : PLAN.seatPrice) / PLAN.includedPerAgent;

export const FLATDESK_ROW: GridRow = {
  vendor: "Flatdesk",
  cells: ["Included", "Included", "Included", `${usd(perAnswer("year"), true)} each or less`],
  note: `All in the seat: ${usd(PLAN.seatPrice)} a month, or ${usd(PLAN.annualSeatPrice)} billed yearly. Each seat includes ${PLAN.includedPerAgent} AI answers a month, so even counting the whole seat an answer costs at most ${usd(perAnswer("year"), true)} (${usd(perAnswer("month"), true)} on monthly billing); optional overage is ${usd(PLAN.overageRate, true)}. Macros never use the AI allowance.`,
};

export const GRID: GridRow[] = [
  {
    vendor: "Zendesk",
    cells: ["$50/agent Copilot add-on", "$50/agent Copilot add-on", "Professional plan, $115/agent", each("zendesk-team")],
    note: "Copilot is $50 per agent a month billed yearly, on top of Suite from $55. AI answer rate is unpublished; third parties put it near $1.50.",
  },
  {
    vendor: "Freshdesk",
    cells: [null, null, "$29/agent Copilot add-on", each("freshdesk-growth")],
    note: "Freddy AI Copilot is sold with Pro ($55) and Enterprise only, and suggests existing canned responses.",
  },
  {
    vendor: "Intercom",
    cells: [null, null, "$29/agent Copilot", each("fin-essential")],
    note: "Copilot includes 10 free conversations per agent a month.",
  },
  { vendor: "Front", cells: [null, null, null, "from $0.05 each"] },
  { vendor: "Help Scout", cells: [null, null, null, each("helpscout-standard")] },
];

export const GRID_SOURCES = [
  { label: "Zendesk pricing", url: "https://www.zendesk.com/pricing/" },
  { label: "Zendesk: macro suggestions", url: "https://support.zendesk.com/hc/en-us/articles/5217191091354" },
  { label: "Zendesk: macro content suggestions", url: "https://support.zendesk.com/hc/en-us/articles/10621284039962" },
  { label: "Zendesk: suggested macros", url: "https://support.zendesk.com/hc/en-us/articles/4408826078362" },
  { label: "Freshdesk pricing", url: "https://www.freshworks.com/freshdesk/pricing/" },
  { label: "Freshdesk: Freddy AI Copilot features", url: "https://support.freshdesk.com/support/solutions/articles/50000010359-overview-of-freddy-ai-for-ticketing" },
  { label: "Intercom pricing", url: "https://www.intercom.com/pricing" },
  { label: "Intercom: Copilot suggests macros", url: "https://www.intercom.com/help/en/articles/8587194-how-to-use-fin-ai-copilot" },
  { label: "Front pricing", url: "https://front.com/pricing" },
  { label: "Help Scout pricing", url: "https://www.helpscout.com/pricing/" },
];
