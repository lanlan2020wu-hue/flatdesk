// Everything Flatdesk does, in one place, for the landing page and the
// sign-in and sign-up screens. Only list what the product actually ships.

export type Feature = { id: string; title: string; body: string; icon: string; isNew?: boolean };
export type FeatureGroup = { id: string; title: string; features: Feature[] };

// 24×24 stroke icons, drawn with currentColor.
const I = {
  inbox: "M4 13h4l1.5 3h5L16 13h4M5 5h14l1 8v6H4v-6z",
  chat: "M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 20 12z",
  mail: "M4 6h16v12H4zM4 7l8 6 8-6",
  macro: "M8 4h8l4 4v12H4V4h4zM8 11h8M8 15h5",
  rule: "M5 6h6M5 12h10M5 18h14M16 3l3 3-3 3",
  tag: "M3 12V4h8l9 9-8 8zM7.5 7.5h.01",
  ai: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z",
  cap: "M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6zM9 12l2 2 4-4",
  receipt: "M7 4h10v16l-2.5-1.5L12 20l-2.5-1.5L7 20zM10 9h4M10 13h4",
  report: "M5 19V9M10 19V5M15 19v-7M20 19v-4",
  import: "M12 4v11m0 0l-4-4m4 4l4-4M5 19h14",
  export: "M12 20V9m0 0l-4 4m4-4l4 4M5 5h14",
  check: "M4 12l5 5L20 6",
  note: "M5 4h14v12l-4 4H5zM15 20v-4h4",
  users: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM21 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8",
  card: "M3 6h18v12H3zM3 10h18M7 15h3",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0",
  clock: "M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 2M9 2h6",
  book: "M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h9M9 8h5",
  smile: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01",
  bolt: "M13 3 5 14h6l-1 7 8-11h-6z",
  bag: "M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2",
  plug: "M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5",
  code: "M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14",
  history: "M4 12a8 8 0 1 0 2.3-5.7M4 4v3h3M12 8v4l3 2",
  spark: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z",
};

// In the order Flatdesk is sold: the flat rate, then AI macros, then the rest.
export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: "pricing",
    title: "Flat rate",
    features: [
      { id: "billing", title: "One flat price", body: "One price per agent, AI answers included. No tiers or add-ons. You pay for the people on your team.", icon: I.card },
      { id: "cap", title: "A limit that's on by default", body: "The AI stops when your included answers run out. Admins get an email at 80% and 100%.", icon: I.cap },
      { id: "receipts", title: "AI receipts", body: "Every AI answer and what it was based on. Refund a wrong one and it stops counting.", icon: I.receipt, isNew: true },
    ],
  },
  {
    id: "automation",
    title: "AI macros and automation",
    features: [
      { id: "suggested-macros", title: "AI macros", body: "When your team sends the same answer on 5 tickets, the AI writes it up as a macro and suggests it on new tickets. If your team keeps editing a macro the same way, the AI suggests an update you apply in one click.", icon: I.spark, isNew: true },
      { id: "macros", title: "Macros that take action", body: "One click replies with the customer's name filled in, assigns the ticket, sets the status, adds tags, and can send right away.", icon: I.macro },
      { id: "rules", title: "Triggers and timed rules", body: "Run on a new ticket, when the customer writes back, or after a ticket sits for a set number of hours. Match subject, message, sender, tags, channel or status, then tag, assign, set the status or leave a note. Timed ones can also email the customer (\"pending 3 days: check in, then close\"). Imported Zendesk triggers and automations that fit keep running.", icon: I.rule, isNew: true },
      { id: "tags", title: "Tags", body: "Tag tickets by hand, from a macro, or from your old help desk's data.", icon: I.tag },
    ],
  },
  {
    id: "ai",
    title: "AI",
    features: [
      { id: "ai", title: "AI answers", body: "Replies to customers on its own, by email and chat, when your macros, help articles or the facts you give it cover the question. It hands the rest to your team. Agents can ask it for a draft or a summary.", icon: I.ai },
      { id: "ai-actions", title: "AI actions", body: "The AI can refund a Stripe payment, cancel a subscription or an unshipped Shopify order, or call your own system to reset a password or change a plan. You set the actions and the limits; anything over a limit waits for a person to approve.", icon: I.bolt, isNew: true },
      { id: "insights", title: "What customers ask about", body: "The AI reads your recent tickets and groups them into topics, with how many the AI answered, why it handed the rest to your team, and one thing to fix for each. On Reports, in the seat.", icon: I.ai, isNew: true },
      { id: "triage", title: "AI sorts new tickets", body: "The AI reads each new ticket and sets its priority, adds tags your team already uses and puts it in the right group, before anyone opens it. It only fills in what nobody set, and a note says what it changed and why. In the seat, not an add-on.", icon: I.ai, isNew: true },
      { id: "website-knowledge", title: "AI reads your website", body: "Add your website or docs address and the AI answers from those pages on day one, beside your macros and help articles, and links customers to the right page. Up to 40 pages per address, read again every week.", icon: I.book, isNew: true },
      { id: "translate", title: "Auto-translate", body: "A customer who writes in Spanish, Japanese or 20 other languages is translated into your team's language when you open the ticket. Translate your reply into theirs before sending, and see both side by side. In the seat, not an add-on.", icon: I.ai, isNew: true },
      { id: "test-drive", title: "AI test drive", body: "After you import, the AI drafts replies to the 50 most recent tickets your team answered, next to your team's reply. Nothing is sent and it uses no AI answers.", icon: I.check, isNew: true },
    ],
  },
  {
    id: "inbox",
    title: "Ticketing",
    features: [
      { id: "inbox", title: "Shared inbox", body: "Email and chat in one queue, with views for mine, my groups, unassigned, open, pending and closed.", icon: I.inbox },
      { id: "email", title: "Email in and out", body: "Forward your support address. Replies go out from it once you add a few DNS records, and thread back onto the same ticket.", icon: I.mail, isNew: true },
      { id: "chat", title: "Website chat widget", body: "One script tag adds a chat bubble to your site. Chats become tickets. Inside your app, signed-in users skip the form and the ticket shows who they are, verified.", icon: I.chat },
      { id: "search", title: "Ticket search", body: "Search every ticket by words in any message or note, the customer's name or email, a tag, or the ticket number.", icon: I.inbox, isNew: true },
      { id: "groups", title: "Groups and sharing in turn", body: "Put agents in groups like Billing or Tier 2 and send tickets there by hand, in bulk or with a trigger. Tickets can go to people in turn, skipping anyone marked away. The AI's answered tickets never land in anyone's queue.", icon: I.users, isNew: true },
      { id: "auto-close", title: "Quiet tickets close themselves", body: "Pending tickets with no reply for a week (or 3 to 30 days) close with a note, set up in one click. A reply opens them again.", icon: I.clock, isNew: true },
      { id: "priority-bulk", title: "Priority and bulk changes", body: "Mark tickets urgent, high, normal or low; urgent ones sit at the top. Tick several in the inbox to close, assign, tag or reprioritize them at once.", icon: I.check, isNew: true },
      { id: "collision", title: "Who's on this ticket", body: "See when a teammate has the ticket open or is writing a reply, and get told when a new message lands while you're on it, so nobody answers twice.", icon: I.users, isNew: true },
      { id: "merge", title: "Merge tickets", body: "When one person writes twice, or two people report the same thing, fold one ticket into the other. Messages, tags and people move across, and replies to the old ticket land on the new one.", icon: I.check, isNew: true },
      { id: "cc", title: "CC on email", body: "Anyone copied on the customer's email stays copied on your replies, and can reply to the ticket themselves. Add or remove people on the ticket.", icon: I.users, isNew: true },
      { id: "signatures", title: "Reply signatures", body: "Each agent sets their own sign-off once in Settings, and it goes under every reply they send. Never under internal notes.", icon: I.note, isNew: true },
      { id: "notes", title: "Internal notes", body: "Talk it over on the ticket without the customer seeing it. Type @ and a name to email a teammate the note.", icon: I.note },
      { id: "customer-history", title: "Customer history", body: "Each ticket lists the customer's other tickets, so you see what they asked before.", icon: I.history, isNew: true },
      { id: "alerts", title: "Slack and webhook alerts", body: "A post in Slack, Discord, Google Chat or any webhook when a ticket needs a person. Not for ones the AI already answered.", icon: I.bell, isNew: true },
      { id: "first-reply-target", title: "Reply time targets", body: "Set a first reply target like 4 business hours, a next reply target for each time the customer writes back, and a resolution target like 3 days, with faster or slower ones by tag (vip: reply in 1 hour, resolve in 24). The resolution clock can pause while a ticket waits on the customer. Tickets count down in the inbox and turn amber near the target. A late one is tagged overdue, posted to Slack, and can go straight to your lead. Reports show how often you hit both.", icon: I.clock, isNew: true },
      { id: "ratings", title: "Ratings", body: "Every reply email ends with Great, Okay or Not good. A Not good on an AI answer sends the ticket to your team.", icon: I.smile, isNew: true },
    ],
  },
  {
    id: "data",
    title: "Help center and data",
    features: [
      { id: "help-center", title: "Help center", body: "A public help center with search, on your own address like help.yourcompany.com. Write an article once. Customers find it on their own and the AI links to it. Offer it in up to 10 more languages: the AI translates each article in one click, you can edit any translation, and visitors see their own language.", icon: I.book, isNew: true },
      { id: "import", title: "Lossless import", body: "Tickets, customers, macros and rules from Zendesk, Intercom, Freshdesk or Help Scout. Every original record is kept.", icon: I.import },
      { id: "export", title: "Export your data", body: "Everything in one .zip, attachments included, or each table as CSV or JSON. Any time, without asking us.", icon: I.export },
      { id: "reports", title: "Reports", body: "Volume, reply and close times, targets met, ratings, the AI's share, and each agent's load.", icon: I.report },
    ],
  },
  {
    id: "integrations",
    title: "Integrations",
    features: [
      { id: "shopify", title: "Shopify orders on the ticket", body: "The customer's latest orders beside their ticket: items, total, payment and delivery status, and tracking links. The AI can read them to answer \"where's my order?\" and cancel unshipped orders.", icon: I.bag, isNew: true },
      { id: "stripe", title: "Stripe on the ticket", body: "The customer's plan, renewal date, and latest payments and refunds beside their ticket. Give the key write access and the AI can refund and cancel within your limits.", icon: I.card, isNew: true },
      { id: "hubspot", title: "HubSpot on the ticket", body: "The customer's HubSpot contact beside their ticket: company, title, lifecycle stage and owner. Closed tickets can be logged on the contact's timeline, adding people who aren't in HubSpot yet.", icon: I.users, isNew: true },
      { id: "jira", title: "Send to Jira", body: "Turn a bug report into a Jira issue from the ticket, with the customer's words and a link back. The ticket shows the issue's status.", icon: I.plug, isNew: true },
      { id: "api", title: "API, Zapier and Make", body: "A REST API and signed webhooks. Make tickets from other apps, start workflows when one comes in, reply and close from a script.", icon: I.code, isNew: true },
      { id: "mcp", title: "Works with Claude and Cursor", body: "Flatdesk is an MCP server. Connect Claude, Cursor or another AI tool with your API key and ask it to find, read, tag, assign or answer tickets.", icon: I.ai, isNew: true },
    ],
  },
  {
    id: "team",
    title: "Team",
    features: [
      { id: "onboarding", title: "Guided setup", body: "A checklist walks you from inbox to first test ticket.", icon: I.check },
      { id: "team", title: "Admins and agents", body: "Invite your team. Admins handle AI settings, imports and billing.", icon: I.users },
    ],
  },
];

export const ALL_FEATURES = FEATURE_GROUPS.flatMap((g) => g.features);
