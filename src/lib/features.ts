// Everything Flatdesk does, in one place, for the landing page and the
// sign-in and sign-up screens. Only list what the product actually ships.

export type Feature = { id: string; title: string; body: string; icon: string };
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
};

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: "inbox",
    title: "Ticketing",
    features: [
      { id: "inbox", title: "Shared inbox", body: "Email and chat in one queue, with views for mine, unassigned, open, pending and closed.", icon: I.inbox },
      { id: "email", title: "Email in and out", body: "Forward your support address. Replies thread back onto the same ticket.", icon: I.mail },
      { id: "chat", title: "Website chat widget", body: "One script tag adds a chat bubble to your site. Chats become tickets.", icon: I.chat },
      { id: "notes", title: "Internal notes", body: "Talk it over on the ticket without the customer seeing it.", icon: I.note },
    ],
  },
  {
    id: "automation",
    title: "Automation",
    features: [
      { id: "macros", title: "Macros", body: "Saved replies that can also add tags and set the status in one click.", icon: I.macro },
      { id: "rules", title: "Assignment rules", body: 'When a ticket is tagged, rules like "if tagged billing, assign to Sam" pick who gets it.', icon: I.rule },
      { id: "tags", title: "Tags", body: "Tag tickets by hand, from a macro, or from your old help desk's data.", icon: I.tag },
    ],
  },
  {
    id: "ai",
    title: "AI",
    features: [
      { id: "ai", title: "AI answers", body: "Answers routine questions from your macros and notes, and hands everything else to your team.", icon: I.ai },
      { id: "cap", title: "A cap that's on by default", body: "The AI pauses at your included resolutions. Admins get an email at 80% and at 100%.", icon: I.cap },
      { id: "receipts", title: "AI receipts", body: "Every AI answer itemized, with the saved answers it used. Refund a wrong one and it stops counting.", icon: I.receipt },
    ],
  },
  {
    id: "data",
    title: "Your data",
    features: [
      { id: "import", title: "Import", body: "Bring tickets, customers, macros and rules from Zendesk, Intercom, Freshdesk or Help Scout.", icon: I.import },
      { id: "export", title: "Export any time", body: "Tickets, messages, customers and macros as CSV or JSON, without asking us.", icon: I.export },
      { id: "reports", title: "Reports", body: "Volume, first response, time to close, AI share and per-agent load.", icon: I.report },
    ],
  },
  {
    id: "team",
    title: "Team and billing",
    features: [
      { id: "onboarding", title: "Guided setup", body: "A checklist walks you from inbox to first test ticket.", icon: I.check },
      { id: "team", title: "Admins and agents", body: "Invite your team. Admins handle AI settings, imports and billing.", icon: I.users },
      { id: "billing", title: "One flat price", body: "Seats times one price. Your seat count follows your team as people join or leave.", icon: I.card },
    ],
  },
];

export const ALL_FEATURES = FEATURE_GROUPS.flatMap((g) => g.features);
