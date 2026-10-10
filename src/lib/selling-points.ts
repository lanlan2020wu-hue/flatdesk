// The reasons teams switch, as one source for the homepage, the
// /features pages, the FAQ, structured data and llms.txt. Every sentence here
// is a claim about the shipped product, so keep it in step with the code.

import { TRIAL_DAYS } from "@/lib/billing";
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
  // One worked example in everyday terms, for readers the steps don't land with.
  example: string;
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
    short: `Seats × ${usd(PLAN.annualSeatPrice)} billed yearly (${usd(PLAN.seatPrice)} monthly), with ${PLAN.includedPerAgent} AI answers per seat. The AI pauses at the cap unless an admin turns on overage. No meters or add-ons.`,
    headline: "A help desk with AI included, and a bill that doesn't move",
    answer: `Flatdesk costs ${PRICE_PHRASE}, and every seat includes ${PLAN.includedPerAgent} AI answers a month, pooled across the team. When the team uses them up, the AI pauses and new conversations go to your agents. You pay nothing extra unless an admin turns on overage (${usd(PLAN.overageRate, true)} per resolution).`,
    metaTitle: "Flat-price help desk with AI included",
    metaDescription: `${PRICE_PHRASE}, with ${PLAN.includedPerAgent} AI answers per agent included. The AI pauses at the cap, so the support bill is the same every month.`,
    example:
      `Say a team of 8 agents pays monthly. That's 8 × ${usd(PLAN.seatPrice)} = ${usd(8 * PLAN.seatPrice)} a month, and the team shares ${8 * PLAN.includedPerAgent} AI answers. In a busy month the AI uses all ${8 * PLAN.includedPerAgent}, then pauses, and the rest of the questions go to the team as normal tickets. The bill is still ${usd(8 * PLAN.seatPrice)}.`,
    steps: [
      { title: "Pick your seats", body: `Every agent seat is ${usd(PLAN.seatPrice)} a month, or ${usd(PLAN.annualSeatPrice)} a month billed yearly, with every feature. No tiers or add-ons.` },
      { title: "Share the AI allowance", body: `Each seat adds ${PLAN.includedPerAgent} AI answers a month to one team pool.` },
      { title: "Get warned before the cap", body: "Admins get an email at 80% and 100%. At 100% the AI pauses and your team answers as usual." },
      { title: "Turn on more if you want", body: `An admin can turn on overage at ${usd(PLAN.overageRate, true)} per resolution, and turn it off any time.` },
    ],
    facts: [
      `${usd(PLAN.seatPrice)} per agent a month with no contract, or ${usd(PLAN.annualSeatPrice)} billed yearly`,
      `${PLAN.includedPerAgent} AI answers per agent a month, shared by the team`,
      "AI pauses at the included amount by default",
      "The AI answers up to 3 follow-ups in one conversation, counted once; conversations it hands to your team don't count",
      `${TRIAL_DAYS} days free, no card`,
    ],
    faq: [
      {
        q: "What does Flatdesk cost?",
        a: `${PRICE_PHRASE}. Both include every feature and ${PLAN.includedPerAgent} AI answers per agent a month, shared by the team.`,
      },
      {
        q: "Is Flatdesk the cheapest help desk?",
        a: "No. Some help desks have cheaper starter seats. What Flatdesk does is keep the AI part of the bill from growing on its own. Once the AI answers a real share of your tickets, it usually costs less than tools that charge for every AI answer.",
      },
      // Same wording as the billing questions, so the FAQ page lists them once.
      ...BILLING_FAQ.filter((f) => f.q.startsWith("What happens when") || f.q.startsWith("What counts")),
    ],
    icon: "M7 4h10v16l-2.5-1.5L12 20l-2.5-1.5L7 20zM10 9h4M10 13h4",
  },
  {
    slug: "ai-macros",
    name: "AI macros",
    short: "The AI writes macros from the answers your team keeps retyping and suggests updates when things change. Each one can also assign, tag, set the status and send.",
    headline: "Your best replies become macros, and stay up to date",
    answer:
      "A macro is a saved reply your team sends with one click instead of typing it again. When your team has sent the same answer on 5 tickets, Flatdesk spots it and the AI writes it up as a macro. New tickets that ask the same thing get it offered. When agents keep making the same edit to a macro before sending, the AI drafts the update and you apply it in one click. Macros can also assign, tag, set the status and send right away. None of this uses your AI allowance.",
    metaTitle: "AI macros: canned responses found and written for you",
    metaDescription:
      "Flatdesk finds the replies your team sends over and over, the AI writes them up as macros, and new tickets get the right one. Works on imported history too.",
    example:
      "Say customers keep asking where their order is. Over a week, Sam, Priya and Lee each type a similar answer on 5 tickets. Flatdesk spots it and the AI writes one \"Where is my order\" macro with [order number] as a blank. You check it and save it. The next time a customer asks, the reply box offers it and one click fills it in. Later your shipping time changes and agents keep fixing that line by hand. The AI notices and suggests the updated macro.",
    steps: [
      { title: "Your team answers as usual", body: "Replies from the last 90 days count, including history you imported from your old help desk." },
      { title: "Flatdesk finds the repeats", body: "The same reply on 5 different tickets becomes one suggested macro." },
      { title: "The AI writes the macro", body: "It reads your team's versions and writes one reply with placeholders, a name, and the question it answers." },
      { title: "It shows up on the right tickets", body: "When a new ticket asks the same question, the reply box offers the macro. AI answers use it too." },
      { title: "It can do more than reply", body: "A macro can fill in the customer's first name, assign the ticket, set the status, add tags, or send right away." },
      { title: "It keeps up with changes", body: "When agents keep editing the macro the same way before sending, the AI rewrites it with that edit. Apply it in one click, or keep the old one." },
    ],
    facts: [
      "Suggests a macro once 5 tickets get the same answer",
      "The AI writes each one from your team's replies, with placeholders for customer details",
      "Offers the matching macro on new tickets, in the reply box",
      "Suggests an update when your team keeps editing a macro the same way, applied in one click",
      "Each macro can assign the ticket, set the status, add tags and send right away",
      "Works on imported history, so suggestions can start on day one",
      "Never uses your AI allowance",
    ],
    faq: [
      {
        q: "How does Flatdesk decide which macros to suggest?",
        a: "It groups agent replies from the last 90 days by how many words they share. When one answer has gone out on 5 different tickets and no existing macro covers it, it becomes a suggestion, and the AI writes it up.",
      },
      {
        q: "How does a macro get updated?",
        a: "Flatdesk compares each sent reply with the macro it started from. If agents made the same change on most of the last sends (at least 3), like a new time frame, an added sentence or a removed step, the AI rewrites the macro with that change. You apply it in one click or keep the old one. Zendesk offers macro suggestions, including edits to existing macros, in its Copilot add-on at $50 per agent a month billed yearly. In Flatdesk they're part of every seat.",
      },
      {
        q: "What can a macro do besides reply?",
        a: "A macro can assign the ticket to a teammate, set it to open, pending or closed, add tags, and send the reply as soon as it's used. [customer name] is filled in with the customer's first name. A macro set to send right away waits if it still has blanks like [order number], so nothing goes out half done.",
      },
      {
        q: "Do AI macros use AI answers?",
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
    short: "Every AI answer you're charged for, with the macros and articles it used. Refund a wrong one in a click and it stops counting.",
    headline: "AI receipts: see every AI answer you pay for, and refund the wrong ones",
    answer:
      "AI receipts are a monthly statement of every conversation Flatdesk's AI answered, with the macros and articles it used and whether each one counted toward your allowance. If the AI got one wrong, an admin refunds it in one click. It stops counting, comes off any overage, and the ticket goes back to your team.",
    metaTitle: "AI receipts: every AI answer listed, wrong ones refunded",
    metaDescription:
      "See every AI answer your help desk charged for, with the macros and articles it used. Refund a wrong one in one click so it stops counting. Download as CSV.",
    example:
      "Say the AI answered 412 tickets in March. One of them told a customer the wrong return window. An admin finds that line on the March receipt and refunds it with a note. It stops counting, and the ticket goes back to the team to put right.",
    steps: [
      { title: "The AI answers a ticket", body: "It answers from your macros, help articles and the facts you give it, and records which ones it used." },
      { title: "It lands on the month's receipt", body: "Each line shows the ticket, the answers cited and a status: included, overage, refunded, or handed to the team." },
      { title: "Refund anything wrong", body: "An admin refunds the line with a note. The ticket reopens for your team with that note attached." },
      { title: "Take it to finance", body: "Download any month as CSV to reconcile it with your invoice." },
    ],
    facts: [
      "Every AI answer listed, month by month",
      "Shows the macros and articles the AI used",
      "Refunds free up allowance and come off any overage",
      "You can refund until the month closes on the 1st",
      "Up to one in five of the month's included answers can be refunded",
      "Download any month as CSV",
    ],
    faq: [
      {
        q: "What is an AI receipt?",
        a: "A monthly statement of every conversation the AI answered, with the macros and articles it used and whether each one counted toward your allowance or overage.",
      },
      {
        q: "Can we get a refund for a wrong AI answer?",
        a: "Yes. An admin refunds the line from the receipt. It stops counting toward the allowance, comes off any overage, and the ticket reopens for your team with an internal note.",
      },
      {
        q: "How long can we refund an AI answer?",
        a: "Until the month closes. Billing runs on the 1st of the next month, and then the receipt is final.",
      },
      {
        q: "Is there a limit on refunds?",
        a: "Yes. Each month a team can refund up to one in five of its included AI answers (at least 5). If the AI is wrong more often than that, turn it off and tell us: the problem is the AI, not your receipt.",
      },
    ],
    icon: "M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6zM9 12l2 2 4-4",
    isNew: true,
  },
  {
    slug: "ai-test-drive",
    name: "AI test drive",
    short: `Import your help desk and the AI drafts answers to the ${TEST_DRIVE.tickets} most recent tickets your team answered, each beside the reply your team actually sent. Judge it on your own customers before you pay.`,
    headline: "Test the AI on your own past tickets before you switch",
    answer: `During the free trial, Flatdesk's AI drafts answers to the ${TEST_DRIVE.tickets} most recent tickets your team answered, using your macros, and shows each draft beside the reply your team actually sent. Your team marks each one ready, needs edits, or wrong, and gets a scorecard. Nothing goes to customers and it doesn't use your AI allowance.`,
    metaTitle: "AI test drive: see AI answers to your own past tickets",
    metaDescription: `Flatdesk drafts AI answers to the ${TEST_DRIVE.tickets} most recent tickets your team answered and shows them beside your team's real replies, so you can judge the AI before you switch.`,
    example:
      `Say your team imports from Zendesk during the trial. The AI drafts replies to your last ${TEST_DRIVE.tickets} answered tickets and puts each one beside what your team sent. Your team marks each draft ready to send, needs edits, or wrong, and the scorecard adds them up. No customer sees any of it.`,
    steps: [
      { title: "Import your history", body: "Connect Zendesk, Intercom, Freshdesk or Help Scout. The test drive starts from the tickets you bring." },
      { title: "The AI drafts answers", body: `It answers the ${TEST_DRIVE.tickets} most recent customer questions your team answered, with the same model and macros it would use live, or says it would hand the ticket to your team.` },
      { title: "Compare side by side", body: "Each draft sits beside the first reply your team sent, so you can see where it matches and where it misses." },
      { title: "Score it", body: "Mark each draft send, edit or wrong. The scorecard shows how many tickets the AI would have handled well." },
    ],
    facts: [
      `Drafts for the ${TEST_DRIVE.tickets} most recent tickets your team answered`,
      "Same model, prompt and macros as live AI answers, minus macros Flatdesk wrote from these replies",
      "Nothing is sent to customers",
      "Doesn't use your AI allowance or show up on receipts",
      `Free during the ${TRIAL_DAYS}-day trial`,
    ],
    faq: [
      {
        q: "Does the test drive use our real tickets?",
        a: `Yes. After you import your help desk, the AI drafts answers to the ${TEST_DRIVE.tickets} most recent tickets your team answered and shows each beside the reply your team sent.`,
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
    short: `Bring tickets, customers, macros and rules from ${IMPORT_SOURCES.join(", ").replace(/, ([^,]*)$/, " or $1")}. Every original record is kept, and anything that didn't fit is listed.`,
    headline: `Move from ${IMPORT_SOURCES.slice(0, 3).join(", ")} or Help Scout without losing a ticket`,
    answer: `Flatdesk imports tickets, messages, attachments, customers, tags, macros and rules (and, from Zendesk, help center articles) from ${IMPORT_SOURCES.join(", ").replace(/, ([^,]*)$/, " and $1")}. Every original record is kept in an archive you can download, and a report lists anything that didn't fit instead of dropping it. Zendesk triggers that check tags, subject, message or channel and tag, assign, set status or add a note keep running as Flatdesk triggers, and automations ("pending 72 hours: email the customer, then close") keep running as timed triggers. The report lists the rest (like triggers that run on any update, emails to anyone but the customer, or Zendesk placeholders) so you can rebuild them. Intercom's API doesn't share its rules at all, and Help Scout workflows come over by name only. You can export everything, attachments included, any time.`,
    metaTitle: "Lossless help desk import from Zendesk, Intercom, Freshdesk and Help Scout",
    metaDescription:
      "Import tickets, attachments, customers, macros and rules from Zendesk, Intercom, Freshdesk or Help Scout. Every original record is kept and nothing is dropped.",
    example:
      "Say your team has three years of tickets in Zendesk. You paste an API token and Flatdesk copies the tickets, customers, macros and tags. A rule like \"if tagged billing, assign to Ana\" keeps working. A Zendesk trigger that checks the subject or message and tags or assigns the ticket keeps running too. So does an automation like \"pending for 3 days: email the customer, then close\", as a timed trigger. A rule Flatdesk can't run, like one that emails someone other than the customer or uses Zendesk placeholders, is listed in the report so you can rebuild it or drop it.",
    steps: [
      { title: "Connect your old help desk", body: "Paste an API token. It's stored encrypted while the import runs and deleted when it ends." },
      { title: "Flatdesk copies your data", body: "Agents, tags, macros, rules, customers, then tickets with their messages and attachments. Big imports pick up where they left off." },
      { title: "Check the report", body: "Anything that didn't fit, like a rule condition Flatdesk doesn't have, is listed with the original record. Download it as CSV." },
      { title: "Keep the originals", body: "Download every original record as JSONL. Running the import again updates records instead of duplicating them." },
    ],
    facts: [
      `Imports from ${IMPORT_SOURCES.join(", ").replace(/, ([^,]*)$/, " and $1")}`,
      "Tickets, messages, attachments, customers, tags, macros and rules (not from Intercom, whose API doesn't share rules, and Help Scout workflows by name only)",
      "Every original record kept and downloadable",
      "Anything that didn't fit is listed in a report, never dropped",
      "Export everything any time, attachments included, without asking us",
    ],
    faq: [
      {
        q: "Which help desks can Flatdesk import from?",
        a: `${IMPORT_SOURCES.join(", ").replace(/, ([^,]*)$/, " and $1")}.`,
      },
      {
        q: "What does the import bring over?",
        a: "Agents, tags, macros, rules, customers and tickets with their messages and attachments. Intercom's API doesn't share rules. Help Scout workflows come over by name only, since its API doesn't share their conditions. A report lists anything that didn't fit, and every original record is kept.",
      },
      {
        q: "Do custom fields, satisfaction ratings and saved views come across?",
        a: "Custom ticket and contact fields come across as ticket and customer fields, along with status, priority, type, group, organization, due date and assignee from your old help desk. From Zendesk, the satisfaction score comes over as a field too. Saved views aren't imported, because Flatdesk's inbox filters work differently; the original records are in the archive and anything that didn't fit is in the report.",
      },
      {
        q: "Does the import change anything in our old help desk?",
        a: "No. It only reads: every request to your old help desk is a read, so tickets, settings and users there stay as they are and you can keep using it side by side during the trial.",
      },
      {
        q: "Can we run the import again?",
        a: "Yes. Records are matched by their original ID, so running it again updates them instead of making duplicates.",
      },
      {
        q: "Can we get our data out of Flatdesk?",
        a: "Yes. Settings has one .zip download with every ticket, message, customer, macro, help article, the audit log and every attachment as its original file. Each table is also available as CSV or JSON.",
      },
    ],
    icon: "M12 4v11m0 0l-4-4m4 4l4-4M5 19h14",
  },
];

export function sellingPoint(slug: string) {
  return SELLING_POINTS.find((p) => p.slug === slug);
}
