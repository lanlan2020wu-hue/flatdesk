// Flatdesk against the tools buyers switch from. Prices come from pricing.ts
// where the calculator also uses them; the rest were read from vendor pricing
// pages on COMPARED_ON (see sources). Say where a rival is the better pick:
// these pages are only useful, to people and to AI answer engines, if they're fair.

import type { QA } from "@/lib/selling-points";
import { COMPETITORS, PLAN, competitorById, competitorMonthly, flatdeskMonthly, usd } from "@/lib/pricing";

export const COMPARED_ON = "2026-09-28";

// Two example teams, used on every comparison.
export const TEAMS = [
  { agents: 3, ai: 150, label: "3 agents, 150 AI answers a month" },
  { agents: 10, ai: 800, label: "10 agents, 800 AI answers a month" },
] as const;

type CostRow = { label: string; costs: number[]; approx: boolean; aiBilling: string };

export type Rival = {
  slug: string;
  name: string;
  // Short "vs" name for titles, e.g. "Intercom (Fin)".
  title: string;
  answer: string;
  flatdeskWins: string[];
  theyWin: string[];
  pickThem: string;
  canImport: boolean;
  // Calculator plans (by id) or fixed figures for vendors the calculator can't model.
  plans: string[];
  fixed?: CostRow[];
  faq: QA[];
  sources: { label: string; url: string }[];
};

const flat: CostRow = {
  label: "Flatdesk",
  costs: TEAMS.map((t) => flatdeskMonthly(t.agents, t.ai).capped),
  approx: false,
  aiBilling: `${PLAN.includedPerAgent} per agent included, pauses at the cap`,
};

export function costRows(r: Rival): CostRow[] {
  const planned = r.plans.map((id) => {
    const c = competitorById(id);
    return {
      label: `${c.vendor} ${c.plan}`,
      costs: TEAMS.map((t) => competitorMonthly(c, t.agents, t.ai).total),
      approx: c.estimated,
      aiBilling: c.aiNote,
    };
  });
  return [flat, ...planned, ...(r.fixed ?? [])];
}

const sourcesFor = (...ids: string[]) => {
  const seen = new Map<string, { label: string; url: string }>();
  for (const c of COMPETITORS.filter((c) => ids.includes(c.id))) for (const s of c.sources) seen.set(s.url, s);
  return [...seen.values()];
};

const importAnswer = (name: string) =>
  `Yes. Flatdesk imports tickets, messages, attachments, customers, tags, macros and rules from ${name}, archives every original record, and lists anything that didn't map.`;

export const RIVALS: Rival[] = [
  {
    slug: "intercom",
    name: "Intercom",
    title: "Intercom (Fin)",
    answer: `Intercom, now sold as Fin, charges $0.99 for every AI outcome on top of seats from $29, with no AI included. Flatdesk is ${usd(PLAN.seatPrice)} per agent with ${PLAN.includedPerAgent} AI resolutions per agent included and a cap that's on by default, so it costs less once the AI answers a real share of tickets. Intercom is ahead on live chat, proactive messaging and channels.`,
    flatdeskWins: [
      `${PLAN.includedPerAgent} AI resolutions per agent included, instead of paying for each one`,
      "The AI pauses at the cap unless you opt in, so the bill can't grow on its own",
      "AI receipts itemize every answer, and you can refund a wrong one",
      "Macros that write themselves from your team's repeated replies",
    ],
    theyWin: [
      "Richer messenger with proactive and outbound messages",
      "More channels, like WhatsApp, SMS and social",
      "Fin can run on top of another help desk",
      "A built-in help center",
    ],
    pickThem: "You sell mostly through in-app chat and want proactive messaging, and a per-outcome AI bill is fine for your volume.",
    canImport: true,
    plans: ["fin-essential", "fin-advanced"],
    faq: [
      { q: "How much does Intercom's Fin AI cost?", a: "$0.99 per Fin outcome, with no volume discount and none included, on top of seats from $29 to $132 per agent per month on annual billing." },
      { q: "Can I move from Intercom to Flatdesk?", a: importAnswer("Intercom") },
    ],
    sources: sourcesFor("fin-essential"),
  },
  {
    slug: "zendesk",
    name: "Zendesk",
    title: "Zendesk",
    answer: `Zendesk Suite starts at $55 per agent on annual billing and charges for automated resolutions past a small allowance. It doesn't publish the per-resolution rate; third parties put it near $1.50 to $2.00. Flatdesk is ${usd(PLAN.seatPrice)} per agent with ${PLAN.includedPerAgent} AI resolutions per agent included and a cap on by default. Zendesk is far broader: help center, many channels, a large app marketplace.`,
    flatdeskWins: [
      "One public price, with AI included and capped",
      "AI receipts with one-click refunds",
      "Macros that write themselves",
      "No tiers or add-ons: every seat gets every feature",
    ],
    theyWin: [
      "Help center, community and many more channels",
      "A large marketplace of integrations",
      "SLAs, satisfaction surveys and advanced workflows",
      "Built for large and enterprise teams",
    ],
    pickThem: "You need a help center, many channels or deep integrations today, or you run a large team with enterprise requirements.",
    canImport: true,
    plans: ["zendesk-team", "zendesk-professional"],
    faq: [
      {
        q: "Does Zendesk charge for AI overage automatically?",
        a: "Since January 1, 2026, Zendesk bills automated resolution overage automatically for Agent Months, Multi-Year and ELA contracts. It announced this on November 11, 2025, and admins can pause AI at the limit.",
      },
      { q: "Can I move from Zendesk to Flatdesk?", a: importAnswer("Zendesk") },
    ],
    sources: sourcesFor("zendesk-team"),
  },
  {
    slug: "help-scout",
    name: "Help Scout",
    title: "Help Scout",
    answer: `Help Scout charges $0.75 per AI resolution on top of seats from $25, and lets admins set a monthly spend cap. Flatdesk is ${usd(PLAN.seatPrice)} per agent with ${PLAN.includedPerAgent} AI resolutions per agent included, so it costs less once the AI is doing real work. Help Scout has a free plan for up to 5 users and a built-in Docs help center.`,
    flatdeskWins: [
      `${PLAN.includedPerAgent} AI resolutions per agent included instead of paying per resolution`,
      "AI receipts with one-click refunds",
      "Macros that write themselves",
      "Lossless import with a raw archive of every record",
    ],
    theyWin: [
      "A free plan for up to 5 users",
      "Docs, a built-in help center",
      "Also lets admins cap AI spend",
      "Lower entry seat price if you use little AI",
    ],
    pickThem: "You're a very small team that uses little AI, or you need a public help center now.",
    canImport: true,
    plans: ["helpscout-standard", "helpscout-plus"],
    faq: [
      { q: "How much does Help Scout AI cost?", a: "$0.75 per AI resolution, with an optional monthly spend cap, on top of seats from $25 per user per month." },
      { q: "Can I move from Help Scout to Flatdesk?", a: importAnswer("Help Scout") },
    ],
    sources: sourcesFor("helpscout-standard"),
  },
  {
    slug: "freshdesk",
    name: "Freshdesk",
    title: "Freshdesk",
    answer: `Freshdesk Growth is $19 per agent on annual billing with 500 AI Agent sessions included, then $49 per 100. For a small team with light AI use it costs less than Flatdesk. Flatdesk (${usd(PLAN.seatPrice)} per agent, ${PLAN.includedPerAgent} AI resolutions per agent) counts resolutions rather than sessions, itemizes every AI answer, and writes macros from your team's replies.`,
    flatdeskWins: [
      "Counts resolutions, not sessions, and hand-offs don't count",
      "AI receipts with one-click refunds",
      "Macros that write themselves",
      "The allowance grows with every seat",
    ],
    theyWin: [
      "Cheaper entry seat ($19 on Growth)",
      "Help center, SLAs and more channels",
      "A large marketplace of apps",
    ],
    pickThem: "Seat price matters most and your AI volume stays under the included sessions.",
    canImport: true,
    plans: ["freshdesk-growth", "freshdesk-pro"],
    faq: [
      { q: "Does Freshdesk have a free plan?", a: "Its pricing page shows only a 14-day trial and paid plans (Growth $19, Pro $55, Enterprise $89 per agent on annual billing)." },
      { q: "Can I move from Freshdesk to Flatdesk?", a: importAnswer("Freshdesk") },
    ],
    sources: sourcesFor("freshdesk-growth"),
  },
  {
    slug: "front",
    name: "Front",
    title: "Front",
    answer: `Front is a collaborative shared inbox with seats from $25 (Starter, up to 10 seats) and an AI agent from $0.05 per conversation, so its AI is cheaper than Flatdesk's overage. Flatdesk (${usd(PLAN.seatPrice)} per agent) is built as a help desk: AI resolutions included and capped, AI receipts, macros that write themselves and lossless import.`,
    flatdeskWins: [
      "AI included in the seat, with a cap on by default",
      "AI receipts with one-click refunds",
      "Macros that write themselves",
      "Lossless import from Zendesk, Intercom, Freshdesk and Help Scout",
    ],
    theyWin: [
      "Cheaper entry seat and cheaper AI per conversation",
      "Built for B2B teams collaborating on email threads",
      "More channels and integrations",
    ],
    pickThem: "Your team works shared email threads with customers more than tickets, and price per seat matters most.",
    canImport: false,
    plans: [],
    fixed: [
      { label: "Front Starter / Professional", costs: [83, 690], approx: false, aiBilling: "From $0.05 per conversation. 10 agents uses Professional ($65), since Starter is single-channel." },
    ],
    faq: [
      { q: "Can Flatdesk import from Front?", a: "Not yet. Flatdesk imports from Zendesk, Intercom, Freshdesk and Help Scout today." },
    ],
    sources: [{ label: "Front pricing", url: "https://front.com/pricing" }],
  },
  {
    slug: "gorgias",
    name: "Gorgias",
    title: "Gorgias",
    answer: `Gorgias prices by ticket volume rather than seats, and third parties report its AI Agent at about $0.90 to $1.00 per automated interaction on top of the ticket fee. Flatdesk is ${usd(PLAN.seatPrice)} per agent with ${PLAN.includedPerAgent} AI resolutions per agent included. Gorgias is built for ecommerce, with native Shopify order data and revenue attribution, which Flatdesk doesn't have.`,
    flatdeskWins: [
      "AI included in the seat instead of charged per interaction",
      "An AI answer is never charged on top of a ticket fee",
      "AI receipts with one-click refunds",
      "Macros that write themselves",
    ],
    theyWin: [
      "Native Shopify integration with order data in the ticket",
      "Revenue attribution and ecommerce automations",
      "Unlimited seats",
    ],
    pickThem: "You run a Shopify store and want order data and refunds inside the ticket.",
    canImport: false,
    plans: [],
    fixed: [
      { label: "Gorgias Basic / Pro", costs: [210, 1160], approx: true, aiBilling: "About $1 per AI interaction plus the ticket fee (third-party figures). Assumes 300 and 2,000 tickets." },
    ],
    faq: [
      { q: "Can Flatdesk import from Gorgias?", a: "Not yet. Flatdesk imports from Zendesk, Intercom, Freshdesk and Help Scout today." },
    ],
    sources: [
      { label: "Gorgias pricing", url: "https://www.gorgias.com/pricing" },
      { label: "Macha: Gorgias pricing explained (third party)", url: "https://www.getmacha.com/blog/gorgias-pricing-explained" },
    ],
  },
];

export function rival(slug: string) {
  return RIVALS.find((r) => r.slug === slug);
}

// "Is Flatdesk cheaper than X?", answered with the example teams' numbers.
export function cheaperAnswer(r: Rival) {
  const [ours, theirs] = costRows(r);
  const parts = TEAMS.map((t, i) => {
    const a = ours.costs[i];
    const b = theirs.costs[i];
    const verdict = a < b ? "Flatdesk is cheaper" : a > b ? `${theirs.label} is cheaper` : "they cost the same";
    return `for ${t.label.replace(" a month", "")}, Flatdesk costs ${usd(a)} a month and ${theirs.label} ${theirs.approx ? "about " : ""}${usd(b)}, so ${verdict}`;
  });
  const s = parts.join("; ");
  return `At list prices checked ${COMPARED_ON}: ${s}.`;
}
