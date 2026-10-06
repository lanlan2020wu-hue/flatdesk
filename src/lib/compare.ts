// Flatdesk against the tools buyers switch from. Prices come from pricing.ts
// where the calculator also uses them; the rest were read from vendor pricing
// pages on COMPARED_ON (see sources). Rivals are listed at their annual-billing
// prices, so Flatdesk's row uses its yearly price too. Say where a rival is the better pick:
// these pages are only useful, to people and to AI answer engines, if they're fair.

import type { QA } from "@/lib/selling-points";
import { CHECKED_ON, COMPETITORS, PLAN, competitorById, competitorMonthly, flatdeskMonthly, usd } from "@/lib/pricing";

export const COMPARED_ON = CHECKED_ON;

// Two example teams, used on every comparison.
export const TEAMS = [
  { agents: 3, ai: 150, label: "3 agents, 150 AI answers a month" },
  { agents: 10, ai: 800, label: "10 agents, 800 AI answers a month" },
] as const;

type CostRow = { label: string; costs: number[]; approx: boolean; aiBilling: string };

export type Rival = {
  slug: string;
  name: string;
  // Short "vs" name for titles, e.g. "Fin (formerly Intercom)".
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
  costs: TEAMS.map((t) => flatdeskMonthly(t.agents, t.ai, "year").capped),
  approx: false,
  aiBilling: `${usd(PLAN.annualSeatPrice)} per agent billed yearly (${usd(PLAN.seatPrice)} monthly). ${PLAN.includedPerAgent} AI answers per agent included, pauses at the cap`,
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

// Intercom's API doesn't share workflows or assignment rules (see import/sources/intercom.ts).
const importAnswer = (name: string) =>
  name === "Intercom"
    ? "Yes. Flatdesk imports conversations, messages, attachments, contacts, tags and macros (where the API returns them) from Intercom, archives every original record, and lists anything that didn't map. Intercom's API doesn't share workflows or assignment rules, so you set those up again in Flatdesk."
    : `Yes. Flatdesk imports tickets, messages, attachments, customers, tags, macros and rules from ${name}, archives every original record, and lists anything that didn't map.${name === "Help Scout" ? " Help Scout workflows come over by name only, since its API doesn't share their conditions." : ""}`;

export const RIVALS: Rival[] = [
  {
    slug: "intercom",
    name: "Intercom",
    title: "Fin (formerly Intercom)",
    answer: `Intercom, now sold as Fin and owned by Salesforce since September 10, 2026, charges $0.99 for every AI outcome on top of seats from $29, with no AI included on those seat plans. Flatdesk is ${usd(PLAN.annualSeatPrice)} per agent on annual billing (${usd(PLAN.seatPrice)} monthly) with ${PLAN.includedPerAgent} AI answers per agent included and a cap that's on by default, so it costs less once the AI answers a real share of tickets. Intercom is ahead on live chat, proactive messaging and channels.`,
    flatdeskWins: [
      `${PLAN.includedPerAgent} AI answers per agent included, instead of paying for each one`,
      "The AI pauses at the cap unless you opt in, so the bill can't grow on its own",
      "AI receipts itemize every answer, and you can refund a wrong one",
      "AI macros, found in your team's repeated replies, that suggest an update when your team keeps editing them",
    ],
    theyWin: [
      "Richer messenger with proactive and outbound messages",
      "More channels, like WhatsApp, SMS and social",
      "Fin can run on top of another help desk",
      "A richer help center, with collections and in-app search",
    ],
    pickThem: "You sell mostly through in-app chat and want proactive messaging, and a per-outcome AI bill is fine for your volume.",
    canImport: true,
    plans: ["fin-essential", "fin-advanced"],
    faq: [
      { q: "How much does Intercom's Fin AI cost?", a: "$0.99 per Fin outcome at list price, with none included on the Essential, Advanced and Expert seat plans, on top of seats from $29 to $132 per agent per month on annual billing. Larger contracts are negotiated." },
      { q: "Can I move from Intercom to Flatdesk?", a: importAnswer("Intercom") },
    ],
    sources: sourcesFor("fin-essential"),
  },
  {
    slug: "zendesk",
    name: "Zendesk",
    title: "Zendesk",
    answer: `Zendesk Suite starts at $55 per agent on annual billing and charges for automated resolutions past a small allowance. It doesn't publish the per-resolution rate; third parties put it near $1.50 to $2.00. Flatdesk is ${usd(PLAN.annualSeatPrice)} per agent on annual billing (${usd(PLAN.seatPrice)} monthly) with ${PLAN.includedPerAgent} AI answers per agent included and a cap on by default. Zendesk is far broader: community forums, many channels, a large app marketplace.`,
    flatdeskWins: [
      "One public price, with AI included and capped",
      "AI macros that suggest updates from your team's edits, included in the seat (Zendesk's macro suggestions need its Copilot add-on, $50 per agent)",
      "AI receipts with one-click refunds",
      "No tiers or add-ons: every seat gets every feature",
    ],
    theyWin: [
      "A full help center with community forums, and many more channels",
      "A large marketplace of integrations",
      "Full SLA policies (per priority, resolution times, escalations) and advanced workflows",
      "Built for large and enterprise teams",
    ],
    pickThem: "You need community forums, many channels or deep integrations today, or you run a large team with enterprise requirements.",
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
    answer: `Help Scout charges $0.75 per AI resolution on top of seats from $25, and lets admins set a monthly spend cap. Flatdesk is ${usd(PLAN.annualSeatPrice)} per agent on annual billing (${usd(PLAN.seatPrice)} monthly) with ${PLAN.includedPerAgent} AI answers per agent included, so it costs less once the AI is doing real work. Help Scout has a free plan for up to 5 users and a built-in Docs help center.`,
    flatdeskWins: [
      `${PLAN.includedPerAgent} AI answers per agent included instead of paying per resolution`,
      "AI receipts with one-click refunds",
      "AI macros written from your replies, with updates suggested from your team's edits. They can also assign, tag and close tickets",
      "Lossless import with a raw archive of every record",
    ],
    theyWin: [
      "A free plan for up to 5 users",
      "Docs, a fuller help center with collections and custom domains",
      "Also lets admins cap AI spend",
      "Lower entry seat price if you use little AI",
    ],
    pickThem: "You're a very small team that uses little AI, or you need a help center on your own domain now.",
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
    answer: `Freshdesk Growth is $19 per agent on annual billing ($23 monthly), but its 500 Freddy AI Agent sessions are a one-time pack for new customers. After that every session costs 49¢, counted whenever the AI replies, whether or not it solves anything. Flatdesk (${usd(PLAN.annualSeatPrice)} per agent on annual billing) includes ${PLAN.includedPerAgent} AI answers per agent every month, counts a conversation once, only when the AI finishes it without handing it to your team, and itemizes each one. Once your AI answers about 41 tickets per agent a month, Flatdesk costs less.`,
    flatdeskWins: [
      `${PLAN.includedPerAgent} AI answers per agent every month, not a one-time 500`,
      "Counts resolutions, not sessions, and hand-offs don't count",
      "AI receipts with one-click refunds",
      "A free AI test drive on your own past tickets before you switch",
    ],
    theyWin: [
      "Cheaper seat when you barely use AI ($19 on Growth)",
      "A fuller help center, full SLA policies with escalations, and more channels",
      "A large marketplace of apps",
    ],
    pickThem: "Your AI answers fewer than about 41 tickets per agent a month, or you need SLA escalations and a marketplace today.",
    canImport: true,
    plans: ["freshdesk-growth", "freshdesk-pro"],
    faq: [
      { q: "Does Freshdesk have a free plan?", a: "Its pricing page shows only a 14-day trial and paid plans (Growth $19, Pro $55, Enterprise $89 per agent on annual billing)." },
      {
        q: "Aren't 500 AI sessions included with Freshdesk?",
        a: "Once. Freshdesk's own help article says new customers get a one-time 500 Freddy AI Agent sessions with their first plan purchase, then packs of 100 for $49. One session covers the AI's replies within 72 hours of a customer's first email (24 hours for chat) and counts whether or not the AI solved anything. The costs on this page are for a normal month after that pack is used up.",
      },
      {
        q: "When is Freshdesk cheaper than Flatdesk?",
        a: `When the AI does little. Both on annual billing, Flatdesk's seat is $20 more than Growth, and 49¢ a session covers that at about 41 AI answers per agent a month. Past that, and up to the ${PLAN.includedPerAgent} per agent Flatdesk includes, Flatdesk costs less.`,
      },
      { q: "Can I move from Freshdesk to Flatdesk?", a: importAnswer("Freshdesk") },
    ],
    sources: sourcesFor("freshdesk-growth"),
  },
  {
    slug: "front",
    name: "Front",
    title: "Front",
    answer: `Front is a collaborative shared inbox with seats from $25 (Starter, up to 10 seats) and an AI agent from $0.05 per conversation, so its AI is cheaper than Flatdesk's overage. Flatdesk (${usd(PLAN.annualSeatPrice)} per agent on annual billing) is built as a help desk: AI resolutions included and capped, AI receipts, AI macros that suggest their own updates, and lossless import.`,
    flatdeskWins: [
      "AI included in the seat, with a cap on by default",
      "AI receipts with one-click refunds",
      "AI macros written from your replies, with updates suggested from your team's edits. They can also assign, tag and close tickets",
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
      { label: "Front Starter", costs: [83, 290], approx: true, aiBilling: "From $0.05 per conversation. Up to 10 seats, one channel." },
      { label: "Front Professional", costs: [203, 690], approx: true, aiBilling: "From $0.05 per conversation." },
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
    answer: `Gorgias prices by ticket volume rather than seats, and third parties report its AI Agent at about $0.90 to $1.00 per automated interaction on top of the ticket fee. Flatdesk is ${usd(PLAN.annualSeatPrice)} per agent on annual billing (${usd(PLAN.seatPrice)} monthly) with ${PLAN.includedPerAgent} AI answers per agent included. Gorgias is built for ecommerce: it can refund and edit Shopify orders from the ticket and attributes revenue to support. Flatdesk shows a customer's Shopify orders beside the ticket, and its AI can cancel and refund an order that hasn't shipped, within limits you set.`,
    flatdeskWins: [
      "AI included in the seat instead of charged per interaction",
      "An AI answer is never charged on top of a ticket fee",
      "AI receipts with one-click refunds",
      "AI macros written from your replies, with updates suggested from your team's edits. They can also assign, tag and close tickets",
    ],
    theyWin: [
      "Order edits, and refunds on shipped orders, in Shopify from the ticket",
      "Revenue attribution and ecommerce automations",
      "Unlimited seats",
    ],
    pickThem: "You run a Shopify store and want to edit orders or refund shipped ones without leaving the ticket.",
    canImport: false,
    plans: [],
    fixed: [
      { label: "Gorgias Basic / Pro", costs: [210, 1160], approx: true, aiBilling: "Monthly-billing plan prices ($60 and $360); yearly is a little less. About $1 per AI interaction plus the ticket fee (third-party figures). Assumes 300 and 2,000 tickets." },
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

// For "<rival> alternative" searches: who Flatdesk fits, and who should stay.
export function alternativeAnswer(r: Rival) {
  const stay = r.pickThem.charAt(0).toLowerCase() + r.pickThem.slice(1).replace(/\.$/, "");
  return `If you're an email and chat team of about 3 to 15 agents and want AI in the seat price, Flatdesk is built for that: ${usd(PLAN.annualSeatPrice)} per agent billed yearly or ${usd(PLAN.seatPrice)} monthly, with ${PLAN.includedPerAgent} AI answers per agent included and a cap on by default.${r.canImport ? ` It imports your ${r.name} history, so you don't start from zero.` : ""} Stay with ${r.name}, or look at a bigger suite, if ${stay}.`;
}
