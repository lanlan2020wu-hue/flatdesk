// The reasons teams switch, as one source for the homepage, the
// /features pages, the FAQ, structured data and llms.txt. Every sentence here
// is a claim about the shipped product, so keep it in step with the code.

import { SWITCH_TRIAL_DAYS, TRIAL_DAYS } from "@/lib/billing";
import { BILLING_FAQ } from "@/lib/faq";
import { PLAN, PRICE_PHRASE, usd } from "@/lib/pricing";
import { TEST_DRIVE } from "@/lib/test-drive";

export type QA = { q: string; a: string };

export type SellingPoint = {
  slug: string;
  name: string;
  // Card and meta copy.
  short: string;
  // The H1: says what it does, in the words a buyer would search.
  headline: string;
  // Two or three sentences that answer "what is this?" on their own, so a
  // search snippet or an AI answer can quote them whole.
  answer: string;
  metaTitle: string;
  metaDescription: string;
  steps: { title: string; body: string }[];
  facts: string[];
  faq: QA[];
  icon: string;
  isNew?: boolean;
};

const IMPORT_SOURCES = ["Zendesk", "Intercom", "Freshdesk", "Help Scout"];

export const SELLING_POINTS: SellingPoint[] = [
  {
    slug: "flat-pricing",
    name: "One flat price",
    short: `Seats × ${usd(PLAN.annualSeatPrice)} billed yearly (${usd(PLAN.seatPrice)} monthly), with ${PLAN.includedPerAgent} AI resolutions per seat. The AI pauses at the cap unless an admin opts in. No meters, no add-on tiers.`,
    headline: "A help desk with AI included, and a bill that doesn't move",
    answer: `Flatdesk costs ${PRICE_PHRASE}, and every seat includes ${PLAN.includedPerAgent} AI resolutions a month, pooled across the team. When the team reaches the included amount, the AI pauses and new conversations go to your agents. Nothing extra is charged unless an admin turns overage on (${usd(PLAN.overageRate, true)} per resolution).`,
    metaTitle: "Flat-price help desk with AI included",
    metaDescription: `${PRICE_PHRASE}, with ${PLAN.includedPerAgent} AI resolutions per agent included. The AI pauses at the cap, so the support bill is the same every month.`,
    steps: [
      { title: "Pick your seats", body: `Every agent seat is ${usd(PLAN.seatPrice)} a month, or ${usd(PLAN.annualSeatPrice)} a month billed yearly, and gets every feature. There are no tiers or add-ons.` },
      { title: "Share the AI allowance", body: `Each seat adds ${PLAN.includedPerAgent} AI resolutions a month to one team pool, however the tickets fall.` },
      { title: "Hit the cap, not a surprise", body: "Admins get an email at 80% and at 100%. At 100% the AI pauses and your team answers as normal." },
      { title: "Opt in to more if you want", body: `An admin can turn on overage at ${usd(PLAN.overageRate, true)} per resolution and turn it off again at any time.` },
    ],
    facts: [
      `${usd(PLAN.seatPrice)} per agent per month billed monthly with no contract, or ${usd(PLAN.annualSeatPrice)} billed yearly`,
      `${PLAN.includedPerAgent} AI resolutions per agent per month, pooled`,
      "AI pauses at the included amount by default",
      "The AI answers up to 3 follow-ups in one conversation, counted once; conversations it hands to your team don't count",
      `${TRIAL_DAYS}-day free trial without a card`,
    ],
    faq: [
      {
        q: "What does Flatdesk cost?",
        a: `${PRICE_PHRASE}. Either way that includes every feature and ${PLAN.includedPerAgent} AI resolutions per agent each month, shared by the team.`,
      },
      {
        q: "Is Flatdesk the cheapest help desk?",
        a: "No. Some help desks have cheaper entry seats. Flatdesk is built so the AI part of the bill can't grow on its own: it's usually cheaper once the AI answers a real share of tickets, compared with tools that charge for every AI answer.",
      },
      // Same wording as the billing questions, so the FAQ page lists them once.
      ...BILLING_FAQ.filter((f) => f.q.startsWith("What happens when") || f.q.startsWith("What counts")),
    ],
    icon: "M7 4h10v16l-2.5-1.5L12 20l-2.5-1.5L7 20zM10 9h4M10 13h4",
  },
  {
    slug: "ai-macros",
    name: "AI macros",
    short: "Evolving macros: the AI writes them from the answers your team keeps retyping and updates them as your business changes. Each one can also assign, tag, set the status and send.",
    headline: "Evolving AI macros that scale with your business, and do the work around the reply too",
    answer:
      "Flatdesk watches the replies your agents send. Once essentially the same answer has gone out on 5 different tickets, it identifies it as a macro, and the AI writes it up from the versions your team sent: a short name, the customer question it answers, and one reply with placeholders where each customer's details go. Save it in one click. From then on, when a new ticket asks that question, the macro is offered right in the reply box. And when agents keep making the same edit to a macro before sending it (a new time frame, an extra line, a step that no longer applies), the AI rewrites the macro with that edit for an admin to apply in one click. So the macros evolve as your prices, policies and products do. Each macro also does the work around the reply: it fills in the customer's first name, assigns the ticket to a teammate, sets the status, adds tags, and can send the reply the moment it's used. None of this uses your AI allowance.",
    metaTitle: "AI macros: canned responses identified and written automatically",
    metaDescription:
      "Flatdesk identifies the replies your team sends over and over, has the AI write them up as macros, and offers the right macro on new tickets. Works from imported history too.",
    steps: [
      { title: "Your team answers as usual", body: "Replies from the last 90 days count, including history you imported from your old help desk." },
      { title: "Flatdesk identifies the repeats", body: "Replies that say essentially the same thing, on 5 different tickets, become one suggested macro." },
      { title: "The AI writes the macro", body: "It reads the versions your team sent and writes one clean reply with placeholders, a name, and the question it answers." },
      { title: "It's offered on the right tickets", body: "When a new ticket asks the same question, the reply box offers the macro. AI answers use it too." },
      { title: "It does the work around the reply", body: "Using a macro can fill in the customer's first name, assign the ticket to a teammate, set the status, add tags, or send the reply right away." },
      { title: "It evolves with your business", body: "When agents keep editing the macro the same way before sending, the AI rewrites it with that edit. Apply it in one click, or keep the macro as it is." },
    ],
    facts: [
      "Identifies a macro once 5 distinct tickets get the same answer",
      "The AI writes each one up from your team's own replies, with placeholders for customer details",
      "Offers the matching macro on new tickets, right in the reply box",
      "Updates a macro when your team keeps editing it the same way before sending",
      "Each macro can assign the ticket, set the status, add tags and send right away",
      "Works from imported history, so suggestions can start on day one",
      "Never uses your AI allowance",
    ],
    faq: [
      {
        q: "How does Flatdesk identify which macros to suggest?",
        a: "It groups agent replies from the last 90 days by how many words they share. When one answer has gone out on 5 different tickets and no existing macro covers it, it becomes a suggestion, and the AI writes it up.",
      },
      {
        q: "How does a macro update itself?",
        a: "When an agent inserts a macro, Flatdesk remembers the macro's text. If on most of the last sends (at least 3) agents made the same change before sending, like a different time frame, an added sentence or a deleted step, the AI rewrites the macro with that change. An admin applies it in one click or keeps the macro as it is. Zendesk offers macro suggestions, including edits to existing macros, in its Copilot add-on at $50 per agent a month billed yearly. In Flatdesk they're part of every seat.",
      },
      {
        q: "What can a macro do besides reply?",
        a: "A macro can assign the ticket to a teammate, set it to open, pending or closed, add tags, and send the reply as soon as it's used. [customer name] is filled in with the customer's first name. A macro set to send right away waits if it still has blanks like [order number], so nothing goes out half filled in.",
      },
      {
        q: "Do AI macros use AI resolutions?",
        a: "No. Writing macros and matching them to tickets never counts toward the AI allowance. Resolutions only count when the AI answers a customer.",
      },
      {
        q: "How does Flatdesk know which macro fits a new ticket?",
        a: "The AI writes down the customer question each macro answers. When a new ticket asks the same thing, the reply box offers that macro, and the agent decides whether to use it.",
      },
      {
        q: "Does it work with history imported from another help desk?",
        a: "Yes. Imported replies count, so a team that brings its history can get AI macros on the first day.",
      },
    ],
    icon: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z",
    isNew: true,
  },
  {
    slug: "ai-receipts",
    name: "AI receipts",
    short: "Every AI answer you're charged for, itemized with the saved answers it used. Refund a wrong one in a click and it stops counting.",
    headline: "AI receipts: see every AI answer you pay for, and refund the wrong ones",
    answer:
      "AI receipts are a monthly, line-by-line statement of every conversation Flatdesk's AI answered, with the saved answers it used and whether each one counted toward your allowance. If the AI got one wrong, an admin refunds it in one click: it stops counting, comes off any overage, and the ticket goes back to your team.",
    metaTitle: "AI receipts: itemized, refundable AI answers",
    metaDescription:
      "See every AI answer your help desk charged for, with the saved answers it cited. Refund a wrong answer in one click so it stops counting. Download as CSV.",
    steps: [
      { title: "The AI answers a ticket", body: "It answers from your macros and notes, and records which ones it used." },
      { title: "It lands on the month's receipt", body: "Each line shows the ticket, the answers cited and a status: included, overage, refunded, customer wrote back, or handed off." },
      { title: "Refund anything wrong", body: "An admin refunds the line with a note. The ticket reopens for your team with that note attached." },
      { title: "Take it to finance", body: "Download any month as CSV to reconcile it with your invoice." },
    ],
    facts: [
      "Every AI event itemized per month",
      "Cites the saved answers the AI used",
      "One-click refunds free up allowance and come off any overage",
      "Refunds are open until that month's overage has been billed",
      "CSV export of any month",
    ],
    faq: [
      {
        q: "What is an AI receipt?",
        a: "A monthly statement of every conversation the AI answered, with the saved answers it cited and whether each one counted toward your allowance or overage.",
      },
      {
        q: "Can we get a refund for a wrong AI answer?",
        a: "Yes. An admin refunds the line from the receipt. It stops counting toward the allowance, comes off any overage, and the ticket reopens for your team with an internal note.",
      },
      {
        q: "How long can we refund an AI answer?",
        a: "Until that month's overage has been billed. Months with no overage stay open.",
      },
    ],
    icon: "M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6zM9 12l2 2 4-4",
    isNew: true,
  },
  {
    slug: "ai-test-drive",
    name: "AI test drive",
    short: `Import your help desk and the AI drafts answers to your ${TEST_DRIVE.tickets} most recent tickets, each beside the reply your team actually sent. Judge the AI on your own customers before you pay.`,
    headline: "Test the AI on your own past tickets before you switch",
    answer: `During the free trial, Flatdesk's AI drafts answers to your ${TEST_DRIVE.tickets} most recent imported tickets using your macros, and shows each draft beside the reply your team actually sent. Your team marks each one as ready to send, needs edits, or wrong, and gets a scorecard. Nothing is sent to customers and it doesn't use your AI allowance.`,
    metaTitle: "AI test drive: see AI answers to your own past tickets",
    metaDescription: `Flatdesk drafts AI answers to your ${TEST_DRIVE.tickets} most recent tickets and shows them beside your team's real replies, so you can judge the AI before you switch.`,
    steps: [
      { title: "Import your history", body: "Connect Zendesk, Intercom, Freshdesk or Help Scout. The test drive starts from the tickets you bring." },
      { title: "The AI drafts answers", body: `It answers your ${TEST_DRIVE.tickets} most recent customer questions with the same model and macros it would use live, or says it would hand the ticket to your team.` },
      { title: "Compare side by side", body: "Each draft sits beside the first reply your team sent, so you can see where it matches and where it misses." },
      { title: "Score it", body: "Mark each draft send, edit or wrong. The scorecard shows how many tickets the AI would have handled well." },
    ],
    facts: [
      `Drafts for your ${TEST_DRIVE.tickets} most recent imported tickets`,
      "Same model, prompt and macros as live AI answers",
      "Nothing is sent to customers",
      "Doesn't use your AI allowance or show up on receipts",
      `Free during the ${TRIAL_DAYS}-day trial`,
    ],
    faq: [
      {
        q: "How can I tell if the AI is good enough before switching?",
        a: `Run the AI test drive. After you import your help desk, the AI drafts answers to your ${TEST_DRIVE.tickets} most recent tickets and shows each beside the reply your team sent, so you judge it on your own customers.`,
      },
      {
        q: "Does the test drive send anything to customers?",
        a: "No. Drafts stay inside Flatdesk for your team to read and score.",
      },
      {
        q: "Does the test drive cost anything?",
        a: "No. It's part of the free trial and doesn't count toward your AI allowance.",
      },
    ],
    icon: "M4 6h10M4 12h7M4 18h10M15 13l2.5 2.5L22 11",
    isNew: true,
  },
  {
    slug: "lossless-import",
    name: "Lossless import",
    short: `Bring tickets, customers, macros and rules from ${IMPORT_SOURCES.join(", ").replace(/, ([^,]*)$/, " or $1")}. Every original record is archived, and anything that didn't map is listed.`,
    headline: `Move from ${IMPORT_SOURCES.slice(0, 3).join(", ")} or Help Scout without losing a ticket`,
    answer: `Flatdesk imports tickets, messages, attachments, customers, tags, macros and rules from ${IMPORT_SOURCES.join(", ").replace(/, ([^,]*)$/, " and $1")}. Every original record is kept in an archive you can download, and anything that couldn't be mapped is listed in a report instead of being dropped. Intercom's API doesn't share workflows or assignment rules, so those are recreated by hand. You can export everything again as CSV or JSON at any time.`,
    metaTitle: "Lossless help desk import from Zendesk, Intercom, Freshdesk and Help Scout",
    metaDescription:
      "Import tickets, attachments, customers, macros and rules from Zendesk, Intercom, Freshdesk or Help Scout. Every raw record is archived and nothing is silently dropped.",
    steps: [
      { title: "Connect your old help desk", body: "Paste an API token. It is stored encrypted while the import runs and erased when it ends." },
      { title: "Flatdesk copies everything", body: "Agents, tags, macros, rules, customers, then tickets with their messages and attachments. Big imports resume where they left off." },
      { title: "Check the report", body: "Anything that didn't map, like a rule condition Flatdesk doesn't have, is listed with the original record. Download it as CSV." },
      { title: "Keep the originals", body: "Download the raw archive of every record as JSONL. Re-running an import updates instead of duplicating." },
    ],
    facts: [
      `Imports from ${IMPORT_SOURCES.join(", ")}`,
      "Tickets, messages, attachments, customers, tags, macros and rules (rules from every source except Intercom, whose API doesn't share them)",
      "Every raw record archived and downloadable",
      "Unmapped items listed in a report, never silently dropped",
      "Export everything as CSV or JSON at any time, without asking us",
      `Finishing an import during the free trial extends it to ${SWITCH_TRIAL_DAYS} days`,
    ],
    faq: [
      {
        q: "Which help desks can Flatdesk import from?",
        a: `${IMPORT_SOURCES.join(", ").replace(/, ([^,]*)$/, " and $1")}.`,
      },
      {
        q: "What does the import bring over?",
        a: "Agents, tags, macros, rules (not from Intercom, whose API doesn't share them), customers and tickets with their messages and attachments. Anything that can't be mapped is listed in a report, and every original record is archived.",
      },
      {
        q: "Can we run the import again?",
        a: "Yes. Records are matched by their original ID, so re-running updates what's there instead of creating duplicates.",
      },
      {
        q: "Can we get our data out of Flatdesk?",
        a: "Yes. Settings has a one-click export of tickets, messages, customers and macros as CSV or JSON.",
      },
    ],
    icon: "M12 4v11m0 0l-4-4m4 4l4-4M5 19h14",
  },
];

export function sellingPoint(slug: string) {
  return SELLING_POINTS.find((p) => p.slug === slug);
}
