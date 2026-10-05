// Free resources for support teams at /free-tools. They stand on their own
// (no signup, Flatdesk mentioned once at the bottom) so other sites have
// something useful to link to. Pages, the sitemap, OG cards and llms.txt all
// read this list.

export type FreeTool = {
  slug: string;
  name: string; // short name for links and cards
  title: string; // page title, written for search
  description: string;
  short: string; // one line for cards linking to it
  intro: string; // the opening paragraph under the headline
  sources: { label: string; url: string }[];
};

export const FREE_TOOLS: FreeTool[] = [
  {
    slug: "support-staffing-calculator",
    short: "How many agents to schedule for chat, phone or email.",
    name: "Support staffing calculator",
    title: "Support staffing calculator: how many agents do you need?",
    description:
      "Free Erlang C calculator for live chat and phone, plus a workload calculator for email. Enter volume, handle time and your service level target to see how many support agents to schedule.",
    intro:
      "Enter how many conversations arrive and how long each one takes. For chat and phone the calculator uses Erlang C to find the agents you need to hit your answer-time target; for email it divides the day's work by each agent's productive hours. Both add shrinkage on top.",
    sources: [
      { label: "Erlang C formula (Wikipedia)", url: "https://en.wikipedia.org/wiki/Erlang_(unit)#Erlang_C_formula" },
      { label: "Erlang B recurrence used for numeric stability (Wikipedia)", url: "https://en.wikipedia.org/wiki/Erlang_(unit)#Erlang_B_formula" },
    ],
  },
  {
    slug: "sla-calculator",
    short: "Due times in business hours, and SLA attainment.",
    name: "SLA due time calculator",
    title: "SLA calculator: first response due time in business hours",
    description:
      "Free SLA calculator. Enter when a ticket arrived, your response target and your business hours to get the exact due time, then check your SLA attainment and how many more misses you can afford.",
    intro:
      "Most support SLAs only count business hours, which makes due times awkward to work out by hand across evenings and weekends. Enter when the ticket arrived, the target, and your hours.",
    sources: [{ label: "Service-level agreement (Wikipedia)", url: "https://en.wikipedia.org/wiki/Service-level_agreement" }],
  },
  {
    slug: "csat-nps-calculator",
    short: "Your score and how much of a change is just noise.",
    name: "CSAT and NPS calculator",
    title: "CSAT and NPS calculator with margin of error",
    description:
      "Free CSAT and Net Promoter Score calculator. Enter your survey counts to get the score and its 95% margin of error, so you can tell a real change from noise.",
    intro:
      "A score from 40 survey answers can move ten points by chance alone. Enter your counts to see the score and how far it could be from the truth, at 95% confidence.",
    sources: [
      { label: "Net promoter score (Wikipedia)", url: "https://en.wikipedia.org/wiki/Net_promoter_score" },
      { label: "Wilson score interval (Wikipedia)", url: "https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval#Wilson_score_interval" },
    ],
  },
  {
    slug: "customer-service-reply-templates",
    short: "Plain replies for refunds, bugs, outages and hard conversations.",
    name: "Customer service reply templates",
    title: "Customer service reply templates: free email and chat responses",
    description:
      "Free customer service reply templates for refunds, bugs, outages, delays, upset customers, cancellations and more. Plain wording, one click to copy.",
    intro:
      "Replies for the situations every support team meets, written to sound like a person: say what happened, what you did, and what happens next. Copy one, fill in the [brackets], and edit it for the customer in front of you.",
    sources: [],
  },
  {
    slug: "customer-support-glossary",
    short: "Support terms and metrics defined in a sentence or two.",
    name: "Customer support glossary",
    title: "Customer support glossary: help desk terms and metrics explained",
    description:
      "Plain definitions of customer support terms and metrics: CSAT, NPS, first response time, SLA, AHT, shrinkage, occupancy, Erlang C and more.",
    intro:
      "The words support teams use every day, defined in a sentence or two. Each term has its own link you can share, and the metrics link to a free calculator.",
    sources: [],
  },
];

export const freeTool = (slug: string) => FREE_TOOLS.find((t) => t.slug === slug);

export const freeToolPath = (slug: string) => `/free-tools/${slug}`;

export function toolBySlug(slug: string): FreeTool {
  const t = freeTool(slug);
  if (!t) throw new Error(`Unknown free tool ${slug}`);
  return t;
}
