import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  jsonb,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Orgs and agents mirror Clerk organizations and memberships. Clerk is the
// source of truth for who belongs to an org; these rows exist so tickets can
// reference agents and so billing can count seats.

// A DNS record the team adds so mail from its own domain is signed and delivered.
export type SendDomainRecord = { type: string; name: string; value: string; priority?: number; status: string };

export const orgs = pgTable("orgs", {
  id: text("id").primaryKey(), // Clerk organization id
  name: text("name").notNull(),
  // AI overage is off unless an admin turns it on. See PLAN in lib/pricing.ts.
  aiOverageEnabled: boolean("ai_overage_enabled").notNull().default(false),
  aiOverageMonthlyLimit: integer("ai_overage_monthly_limit"), // null = no extra limit
  // The AI answers new email and chat tickets when it can, using these notes and the
  // team's macros as its knowledge. Admins can switch it off.
  aiEnabled: boolean("ai_enabled").notNull().default(true),
  aiInstructions: text("ai_instructions").notNull().default(""),
  // Highest usage warning (80 or 100, percent of the included allowance)
  // already emailed to admins for aiNoticeMonth, so each goes out once.
  aiNoticeMonth: text("ai_notice_month"),
  // The trial review an admin left in exchange for PLAN.trialReviewBonus extra AI
  // answers. Any rating earns it. reviewPublic says Flatdesk may quote it by name.
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewRating: integer("review_rating"),
  reviewText: text("review_text"),
  reviewPublic: boolean("review_public").notNull().default(false),
  aiNoticeLevel: integer("ai_notice_level").notNull().default(0),
  // Stripe billing. One subscription per org, quantity = seats (Clerk members).
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionStatus: text("subscription_status"), // Stripe's status: trialing, active, past_due, canceled...
  billedSeats: integer("billed_seats"),
  billingInterval: text("billing_interval"), // "month" or "year", copied from the Stripe subscription
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  overageBilledMonth: text("overage_billed_month"), // last month whose AI overage was added to an invoice
  nextTicketNumber: integer("next_ticket_number").notNull().default(1),
  // Customers' email reaches the org at <inboundKey>@INBOUND_DOMAIN. Teams
  // forward their own support address there.
  // Drawn from gen_random_uuid(), which uses a secure random source (random() does not).
  inboundKey: text("inbound_key").notNull().unique().default(sql`substr(md5(gen_random_uuid()::text), 1, 12)`),
  // Public id in the website chat widget's embed code.
  widgetKey: text("widget_key").notNull().unique().default(sql`substr(md5(gen_random_uuid()::text), 1, 16)`),
  // The team's public support address (support@theircompany.com), entered
  // during onboarding. Used for the end-to-end test email.
  supportEmail: text("support_email"),
  onboarding: jsonb("onboarding").$type<Onboarding>().notNull().default({}),
  // What the AI test drive has cost us so far, across every run. Capped at
  // TEST_DRIVE.budgetUsd in lib/test-drive.ts.
  testDriveSpentUsd: numeric("test_drive_spent_usd", { precision: 10, scale: 5 }).notNull().default("0"),
  // Length of the no-card trial (TRIAL_DAYS in lib/billing.ts).
  trialDays: integer("trial_days").notNull().default(14),
  // Alerts to Slack (or any webhook) when a ticket needs a person. See lib/alerts.ts.
  alertWebhookUrl: text("alert_webhook_url"),
  alertOn: text("alert_on").$type<AlertOn>().notNull().default("team"),
  // Signs generic webhook payloads (X-Flatdesk-Signature) so receivers can check them.
  alertSecret: text("alert_secret").notNull().default(sql`replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')`),
  alertLastAt: timestamp("alert_last_at", { withTimezone: true }),
  alertLastError: text("alert_last_error"),
  // One-click ratings under every reply email. See lib/csat.ts.
  csatEnabled: boolean("csat_enabled").notNull().default(true),
  // First-reply target in minutes (null = off), counted in business hours when set. See lib/sla.ts.
  firstResponseMinutes: integer("first_response_minutes").default(240),
  // Who gets a ticket that misses its first-reply target (null = leave it with whoever has it). See lib/escalation.ts.
  escalateTo: text("escalate_to"),
  // Resolution target in minutes (null = off): from arrival to closed, on the same clock as the first-reply target.
  resolveMinutes: integer("resolve_minutes"),
  // Next-reply target in minutes (null = off): once the team has answered,
  // each time the customer writes back the team should reply within this.
  nextReplyMinutes: integer("next_reply_minutes"),
  // Time a ticket spends pending (waiting on the customer) doesn't count toward the resolution target.
  pauseWhilePending: boolean("pause_while_pending").notNull().default(false),
  // New tickets nobody routed go to the team in turn once they need a person
  // (lib/routing.ts). Groups can share their own tickets in turn too.
  shareInTurn: boolean("share_in_turn").notNull().default(false),
  // The language the team works in. Customer messages in another language are
  // translated into it, and replies can go out in the customer's (lib/translate.ts).
  language: text("language").notNull().default("en"),
  businessHours: jsonb("business_hours").$type<BusinessHours>(),
  slaPolicies: jsonb("sla_policies").$type<SlaPolicy[]>().notNull().default([]),
  // Signs who is signed in on the team's own site, so chat can trust the visitor's email (lib/chat-identity.ts).
  chatSecret: text("chat_secret").notNull().default(sql`replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')`),
  // Public help center at /help/<helpSlug>. Set the first time an admin opens it.
  helpSlug: text("help_slug").unique(),
  // The team's own address for it, like help.acme.com (lowercase host), and
  // when Flatdesk last saw it pointed here and serving. Links use it once verified.
  helpDomain: text("help_domain").unique(),
  helpDomainVerifiedAt: timestamp("help_domain_verified_at", { withTimezone: true }),
  // Replies sent from the team's own address, like support@acme.com, once its
  // domain is verified with the email provider (lib/send-domain.ts). Until
  // then, and if it's removed, replies go out from EMAIL_FROM.
  sendAddress: text("send_address"),
  sendDomain: text("send_domain").unique(),
  sendDomainId: text("send_domain_id"),
  sendDomainRecords: jsonb("send_domain_records").$type<SendDomainRecord[]>(),
  sendDomainAddedAt: timestamp("send_domain_added_at", { withTimezone: true }),
  sendDomainVerifiedAt: timestamp("send_domain_verified_at", { withTimezone: true }),
  // Languages the help center offers besides the team's own (orgs.language).
  helpLanguages: text("help_languages").array().notNull().default(sql`'{}'::text[]`),
  // Security controls for teams that go through vendor review. See lib/security.ts.
  // Off: nothing is sent to the AI provider for this team (answers, drafts, macros, test drive).
  aiProcessing: boolean("ai_processing").notNull().default(true),
  // Everyone must have two-step verification on their Clerk account to open the app.
  requireTwoFactor: boolean("require_two_factor").notNull().default(false),
  // The AI reads a verified customer's orders and payments from connected
  // Shopify and Stripe when it answers. See lib/ai-actions.ts.
  aiReadsRecords: boolean("ai_reads_records").notNull().default(false),
  // The AI learns from tickets the team solves and keeps what it learned up
  // to date on its own. See lib/learn.ts.
  aiAutoLearn: boolean("ai_auto_learn").notNull().default(true),
  // Email from these senders goes straight to the trash: whole addresses, or
  // "@domain.com" for everyone at a domain. Lowercase. See lib/trash.ts.
  blockedSenders: text("blocked_senders").array().notNull().default(sql`'{}'::text[]`),
  // The AI sets priority, tags and group on each new ticket (lib/triage.ts).
  aiTriage: boolean("ai_triage").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Progress through the new-team checklist at /app/welcome. Most steps are
// also detected from real data (a forwarded email arrived, an import ran).
export type Onboarding = {
  skipped?: OnboardingStep[];
  dismissed?: boolean;
  invited?: string[]; // emails invited from the checklist
  forwardingConfirmed?: boolean; // the admin said forwarding is set up
  widgetAdded?: boolean; // the admin said the chat widget is on their site
  aiAnswered?: boolean; // the AI answered a question the admin tried during setup
  gmailConfirmation?: { code: string | null; link: string | null; receivedAt: string };
  testToken?: string; // subject token of the end-to-end test email
  testSentAt?: string;
  testReplyTo?: string; // the admin who sent the test, who gets replies to the test ticket
  source?: SignupSource; // where the person who created the team came from (lib/attribution.ts)
  milestones?: Partial<Record<Milestone, string>>; // when each funnel milestone first happened (lib/funnel.ts)
};
export type SignupSource = {
  source: string; // utm_source, ?ref=, the referring site, or "direct"
  medium?: string;
  campaign?: string;
  referrer?: string; // referring host
  landing?: string; // first page seen
  at: string;
};
export type Milestone =
  | "team_created"
  | "agent_invited"
  | "forwarding_confirmed"
  | "test_email_sent"
  | "sample_ticket_created"
  | `skipped_${OnboardingStep}`
  | "onboarding_dismissed"
  | "channel_connected"
  | "first_customer_ticket"
  | "import_started"
  | "test_drive_started"
  | "first_ai_answer"
  | "card_added";
// "team": only tickets that need a person. "all": every new ticket, saying whether the AI answered it.
export type AlertOn = "team" | "all";
// Trigger conditions and actions (lib/triggers.ts). Text values are a list of
// words or phrases separated by commas; "includes" means any of them appears.
export type TriggerCondition =
  | { field: "subject" | "body" | "subject_or_body" | "from"; op: "includes" | "excludes"; value: string }
  | { field: "tags"; op: "includes" | "excludes"; value: string }
  | { field: "channel"; op: "is" | "is_not"; value: "email" | "chat" }
  | { field: "status"; op: "is" | "is_not"; value: "open" | "pending" | "closed" };
// When a trigger runs: on a new ticket, when the customer writes back, or
// after a ticket has had no update for `hours` (once per ticket until it changes).
export type TriggerEvent = "created" | "updated" | "timed";
export type TriggerAction =
  | { type: "assign"; to: string } // agents.user_id
  | { type: "add_tags"; tags: string[] }
  | { type: "set_status"; status: "open" | "pending" | "closed" }
  | { type: "note"; body: string }
  | { type: "reply"; body: string } // emails the customer; timed triggers only
  | { type: "group"; groupId: string }; // groups.id

// A faster (or slower) first-reply target for tickets with a tag. See lib/sla.ts.
export type SlaPolicy = { tag: string; minutes: number; resolveMinutes?: number | null };

export type BusinessHours = {
  tz: string; // IANA time zone, e.g. "America/New_York"
  days: number[]; // 0 = Sunday ... 6 = Saturday
  start: number; // minutes after local midnight
  end: number;
};
export type OnboardingStep = "ai" | "invite" | "inbox" | "import" | "test";

export const agentRole = pgEnum("agent_role", ["admin", "agent"]);

export const agents = pgTable(
  "agents",
  {
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(), // Clerk user id
    name: text("name").notNull(),
    email: text("email").notNull(),
    role: agentRole("role").notNull().default("agent"),
    // A viewer reads tickets but can't change them, and isn't billed as a seat. Admins never are.
    viewer: boolean("viewer").notNull().default(false),
    // Added under every reply this person sends (not notes or AI answers).
    signature: text("signature").notNull().default(""),
    // Away people are skipped when tickets are shared in turn.
    away: boolean("away").notNull().default(false),
    // When tickets were last shared to them in turn, so the next goes to whoever waited longest.
    lastTurnAt: timestamp("last_turn_at", { withTimezone: true }),
    // Set when the person left the team in Clerk. They keep their name on old
    // tickets but can't be assigned, get emails or count as a seat.
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    // Original fields from an imported help desk (phone, company, custom
    // fields), as label -> value. The full record is kept in import_records.
    fields: jsonb("fields").$type<Record<string, string>>().notNull().default({}),
    // The part after the @, so customers group into companies (lib/companies.ts).
    domain: text("domain").generatedAlwaysAs(sql`lower(split_part(email, '@', 2))`),
    // What the team knows about this person (lib/customer-profile.ts): shown
    // beside every ticket from them. vip puts a badge on their tickets.
    notes: text("notes").notNull().default(""),
    vip: boolean("vip").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("customers_org_email").on(t.orgId, t.email), index("customers_org_domain").on(t.orgId, t.domain)],
);

// What the team knows about a company: customers are grouped by their email
// domain without a row here; one is saved once someone names it or adds notes.
export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    name: text("name"),
    notes: text("notes").notNull().default(""),
    updatedBy: text("updated_by"), // agents.name
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("companies_org_domain").on(t.orgId, t.domain)],
);

export const ticketStatus = pgEnum("ticket_status", ["open", "pending", "closed"]);
export const channel = pgEnum("channel", ["email", "chat"]);
export const ticketPriority = pgEnum("ticket_priority", ["low", "normal", "high", "urgent"]);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    number: integer("number").notNull(), // shown to people as #1042, unique per org
    subject: text("subject").notNull(),
    status: ticketStatus("status").notNull().default("open"),
    priority: ticketPriority("priority").notNull().default("normal"),
    channel: channel("channel").notNull(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    assigneeId: text("assignee_id"), // agents.user_id within the same org
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    // Other people copied on replies: from the email's To and Cc, or added by an agent.
    cc: text("cc").array().notNull().default(sql`'{}'::text[]`),
    // Set when this ticket was merged into another (lib/merge.ts). Its
    // messages moved there; mail to this ticket goes there too.
    mergedIntoId: uuid("merged_into_id"),
    // The group the ticket belongs to (Billing, Tier 2...). See lib/routing.ts.
    groupId: uuid("group_id"),
    externalId: text("external_id"), // "<source>:<id>" for imported tickets, e.g. "zendesk:4521"
    source: text("source"), // "zendesk", "intercom", ... for imported tickets
    // Original fields that have no Flatdesk equivalent (priority, group,
    // custom fields), as label -> value, shown on the ticket.
    fields: jsonb("fields").$type<Record<string, string>>().notNull().default({}),
    // Imported tickets whose agent hasn't joined Flatdesk yet are assigned to
    // them automatically when they do.
    pendingAssigneeEmail: text("pending_assignee_email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    // When it missed its first-reply target and was escalated (lib/escalation.ts).
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    // When it missed its resolution target and was escalated.
    resolveEscalatedAt: timestamp("resolve_escalated_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    // Kept by database triggers (migration 0035), so every way a ticket
    // changes is counted. awaitingSince: when the customer wrote back after the
    // team's last reply (null once someone replies). pendingSince and
    // pausedSeconds: time spent pending, for pausing the resolution clock.
    awaitingSince: timestamp("awaiting_since", { withTimezone: true }),
    nextEscalatedAt: timestamp("next_escalated_at", { withTimezone: true }),
    pendingSince: timestamp("pending_since", { withTimezone: true }),
    pausedSeconds: integer("paused_seconds").notNull().default(0),
    // When the ticket was last logged to the customer's CRM record (HubSpot write-back).
    crmLoggedAt: timestamp("crm_logged_at", { withTimezone: true }),
    // Timed triggers (lib/triggers.ts): the ones that ran since the customer or
    // team last wrote, and the ones that didn't match it as of timedSkippedAt.
    timedRan: uuid("timed_ran").array().notNull().default(sql`'{}'::uuid[]`),
    timedSkipped: uuid("timed_skipped").array().notNull().default(sql`'{}'::uuid[]`),
    timedSkippedAt: timestamp("timed_skipped_at", { withTimezone: true }),
    resolvedByAi: boolean("resolved_by_ai").notNull().default(false),
    // Chat tickets: the visitor's browser holds this to read and continue the thread.
    visitorToken: text("visitor_token"),
    // Made by an admin from /app/test-tickets to see how Flatdesk handles a
    // situation. Kept out of reports, the AI allowance and the test drive.
    test: boolean("test").notNull().default(false),
    // In the trash (lib/trash.ts): hidden from every view, search and report,
    // and deleted for good after TRASH_DAYS. deletedStatus is what restoring
    // puts back; a trashed ticket is closed so nothing works on it meanwhile.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedStatus: ticketStatus("deleted_status"),
    // Snoozed (lib/snooze.ts): out of the working views until then, when it
    // comes back to Open. A customer message wakes it sooner.
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    snoozedBy: text("snoozed_by"),
    // Browser alerts (lib/browser-alerts.ts): when the ticket became the team's
    // after the AI had its turn, and when it was last given to someone (set by
    // a database trigger, so every way of assigning counts).
    needsTeamAt: timestamp("needs_team_at", { withTimezone: true }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("tickets_org_number").on(t.orgId, t.number),
    index("tickets_org_status_updated").on(t.orgId, t.status, t.updatedAt),
    index("tickets_org_assignee").on(t.orgId, t.assigneeId),
    index("tickets_org_needs_team").on(t.orgId, t.needsTeamAt),
    // The wake-up job looks for snoozes that are up.
    index("tickets_snoozed_until").on(t.snoozedUntil).where(sql`${t.snoozedUntil} is not null`),
    // Makes imports safe to re-run: a ticket already imported is skipped.
    uniqueIndex("tickets_org_external").on(t.orgId, t.externalId),
    // Reports, insights and the HubSpot sync filter by when tickets arrived or closed.
    index("tickets_org_created").on(t.orgId, t.createdAt),
    index("tickets_org_closed_at").on(t.orgId, t.closedAt).where(sql`${t.status} = 'closed'`),
    // "Their other tickets" on every ticket view, and customer export.
    index("tickets_customer_created").on(t.customerId, t.createdAt),
    // Timed triggers look for tickets untouched for a while.
    index("tickets_org_updated").on(t.orgId, t.updatedAt).where(sql`${t.deletedAt} is null`),
    // The SLA job (lib/escalation.ts) runs every five minutes across every team.
    index("tickets_first_reply_due")
      .on(t.createdAt)
      .where(sql`${t.status} = 'open' and ${t.firstResponseAt} is null and ${t.escalatedAt} is null and ${t.source} is null`),
    index("tickets_resolve_due").on(t.createdAt).where(sql`${t.status} <> 'closed' and ${t.resolveEscalatedAt} is null and ${t.source} is null`),
    index("tickets_next_reply_due").on(t.awaitingSince).where(sql`${t.status} = 'open' and ${t.firstResponseAt} is not null and ${t.source} is null`),
  ],
);

export const authorType = pgEnum("author_type", ["customer", "agent", "ai", "system"]);

// Side conversations: a supplier, courier or another team emailed from a
// ticket. Their messages are internal notes on the ticket (messages.side_id),
// so the customer never sees them; replies find their way back by the token in
// the Reply-To or by the email's In-Reply-To (lib/side-conversations.ts).
export const sideConversations = pgTable(
  "side_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    toEmail: text("to_email").notNull(),
    toName: text("to_name"),
    subject: text("subject").notNull(),
    createdBy: text("created_by").notNull(), // agents.user_id
    closedAt: timestamp("closed_at", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("side_conversations_token").on(t.token), index("side_conversations_ticket").on(t.ticketId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
    authorType: authorType("author_type").notNull(),
    authorId: text("author_id"), // agent user id or customer id; null for ai/system
    // Imported messages keep who wrote them even when that person isn't on the team.
    authorName: text("author_name"),
    authorEmail: text("author_email"),
    externalId: text("external_id"),
    body: text("body").notNull(),
    internal: boolean("internal").notNull().default(false), // internal notes never reach the customer
    emailMessageId: text("email_message_id"), // Message-ID header, for threading replies
    deliveryError: text("delivery_error"), // set when an outbound email failed to send
    // Auto-translate: a customer message in the team's language, and the
    // language it came in.
    translation: text("translation"),
    translatedFrom: text("translated_from"),
    // A reply sent in the customer's language: what the agent wrote.
    original: text("original"),
    // Part of a side conversation (always internal).
    sideId: uuid("side_id").references(() => sideConversations.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("messages_ticket_created").on(t.ticketId, t.createdAt),
    // One copy of each inbound email, even when the provider delivers it twice at once.
    uniqueIndex("messages_org_email_message_id").on(t.orgId, t.emailMessageId).where(sql`${t.emailMessageId} is not null`),
    index("messages_ticket_external").on(t.ticketId, t.externalId),
    // Ticket search (lib/search.ts) matches words in any message.
    index("messages_body_search").using("gin", sql`to_tsvector('simple', ${t.body})`),
    // Agent replies: per-agent counts in Reports, and the repeated-reply finder for AI macros.
    index("messages_agent_replies").on(t.orgId, t.authorId, t.createdAt).where(sql`${t.authorType} = 'agent' and not ${t.internal}`),
    index("messages_org_agent_created").on(t.orgId, t.createdAt.desc()).where(sql`${t.authorType} = 'agent' and not ${t.internal}`),
  ],
);

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

// Files on email and chat messages. Stored in Postgres so every download goes
// through the same org and visitor checks as the rest of the ticket.
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    data: bytea("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("attachments_message").on(t.messageId), index("attachments_ticket").on(t.ticketId)],
);

// A customer's one-click rating of one reply (an agent's or the AI's), from the
// links under the reply email. One rating per reply; clicking again changes it.
export const csatRating = pgEnum("csat_rating", ["great", "okay", "bad"]);

export const csatRatings = pgTable(
  "csat_ratings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
    rating: csatRating("rating").notNull(),
    // Who wrote the rated reply: "ai" or "agent", and which agent.
    ratedAuthorType: authorType("rated_author_type").notNull(),
    agentId: text("agent_id"),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("csat_ratings_message").on(t.messageId), index("csat_ratings_org_created").on(t.orgId, t.createdAt), index("csat_ratings_ticket").on(t.ticketId)],
);

export const macros = pgTable("macros", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  body: text("body").notNull(),
  addTags: text("add_tags").array().notNull().default(sql`'{}'::text[]`),
  setStatus: ticketStatus("set_status"), // null = leave status unchanged
  assignTo: text("assign_to"), // agent user id; null = leave the assignee unchanged
  sendNow: boolean("send_now").notNull().default(false), // using the macro sends the reply at once
  source: text("source"), // import source ("zendesk", ...) or "suggested" when saved from a repeated-reply suggestion
  // What customers ask when this macro is the answer, in a sentence. The AI
  // writes it for suggested macros; the ticket page matches new tickets to it.
  question: text("question"),
  externalId: text("external_id"),
  // Actions from the original macro that Flatdesk can't perform, in words
  // ("Set priority to High"). Shown on the macro so nothing is silently lost.
  notApplied: text("not_applied").array().notNull().default(sql`'{}'::text[]`),
  // Imported from a macro only the team could see (a Zendesk personal macro, a
  // Freshdesk note). Agents can use it; the AI never reads it.
  internal: boolean("internal").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Re-running an import updates a macro instead of adding a second copy.
  uniqueIndex("macros_org_source_external").on(t.orgId, t.source, t.externalId).where(sql`${t.externalId} is not null`),
]);

// Repeated replies an admin or agent chose not to turn into a macro. Kept as
// the cleaned reply text so the same answer isn't suggested again, even after
// its wording drifts a little. See lib/macro-suggestions.ts.
export const macroSuggestionDismissals = pgTable(
  "macro_suggestion_dismissals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    dismissedBy: text("dismissed_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("macro_suggestion_dismissals_org").on(t.orgId)],
);

// Help center articles. Published ones are public at /help/<org>/<slug> and
// are part of what the AI answers from. See lib/help.ts.
export const articles = pgTable(
  "articles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    // Set from the title when the article is created and kept, so links don't break on a rename.
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(), // plain text with a little markdown, see renderArticle()
    published: boolean("published").notNull().default(false),
    // Team only: never on the help center or used by the AI that answers
    // customers; agents read it in Flatdesk and AI drafts for agents use it.
    internal: boolean("internal").notNull().default(false),
    // Groups articles on the help center ("Billing", "Getting started"). Null: shown under "More articles".
    section: text("section"),
    // Set for articles imported from another help desk, so a re-import updates instead of duplicating.
    source: text("source"),
    externalId: text("external_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("articles_org_slug").on(t.orgId, t.slug),
    index("articles_org_published").on(t.orgId, t.published),
    uniqueIndex("articles_org_source_external").on(t.orgId, t.source, t.externalId).where(sql`${t.externalId} is not null`),
  ],
);

// A help center category (articles.section, matched by name): its place in
// the order and a line about it. Sections without a row sort by name after
// the ordered ones (lib/help-sections.ts).
export const helpSections = pgTable(
  "help_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("help_sections_org_name").on(t.orgId, t.name)],
);

// An article in one of the help center's other languages (orgs.helpLanguages).
// auto: written by the AI and not edited since. Out of date when the article
// changed after sourceUpdatedAt.
export const articleTranslations = pgTable(
  "article_translations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    articleId: uuid("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
    language: text("language").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    section: text("section"),
    auto: boolean("auto").notNull().default(false),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("article_translations_article_language").on(t.articleId, t.language), index("article_translations_org_language").on(t.orgId, t.language)],
);

// What visitors type into the help center's search box, and how many articles
// came back, so a team can see what people look for and what's missing
// (lib/help-searches.ts). No visitor details; kept HELP_SEARCH_DAYS.
export const helpSearches = pgTable(
  "help_searches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    query: text("query").notNull(),
    results: integer("results").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("help_searches_org_created").on(t.orgId, t.createdAt)],
);

// v1 rules are deliberately narrow: "when a ticket has tag X, assign it to Y".
export const rules = pgTable("rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  ifTag: text("if_tag").notNull(),
  assignTo: text("assign_to").notNull(), // agents.user_id
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("rules_org_tag_assignee").on(t.orgId, t.ifTag, t.assignTo)]);

// Triggers: "when a ticket matches these conditions, do these things". Run in
// order of position on every new ticket (before the tag rules above), when the
// customer writes back, or on a timer. See lib/triggers.ts.
export const triggers = pgTable("triggers", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  matchAll: boolean("match_all").notNull().default(true),
  event: text("event").$type<TriggerEvent>().notNull().default("created"),
  hours: integer("hours"), // timed triggers: hours since the ticket's last update
  conditions: jsonb("conditions").$type<TriggerCondition[]>().notNull().default([]),
  actions: jsonb("actions").$type<TriggerAction[]>().notNull().default([]),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("triggers_org_position").on(t.orgId, t.position)]);

// "refunded": an admin marked a resolution as wrong on the receipts page, so it no longer counts.
// "followup": a call answering the customer again on a ticket that already counts; never counted itself.
export const aiEventKind = pgEnum("ai_event_kind", ["resolution", "draft", "handoff", "refunded", "followup"]);

// Internal metering. Customers never see per-call costs, but we log every
// call to check real cost per resolution against the $49 seat price.
export const aiEvents = pgTable(
  "ai_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id").references(() => tickets.id, { onDelete: "set null" }),
    kind: aiEventKind("kind").notNull(),
    month: text("month").notNull(), // "2026-09", in UTC
    overage: boolean("overage").notNull().default(false),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 5 }).notNull().default("0"),
    // Titles of the saved answers the AI relied on, shown on the receipt.
    sources: text("sources").array().notNull().default(sql`'{}'::text[]`),
    reason: text("reason"),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    refundedBy: text("refunded_by"),
    refundNote: text("refund_note"),
    // On a test ticket: never counted or billed, paid from the test budget (lib/test-tickets.ts).
    test: boolean("test").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_events_org_month").on(t.orgId, t.month, t.kind), index("ai_events_ticket").on(t.ticketId, t.kind, t.createdAt)],
);

// AI macros: the macro the AI wrote for one group of repeated replies, keyed
// by the group's representative reply so each group is written once. Written
// on our dime, never counted toward the AI allowance. See lib/macro-writer.ts.
export const macroAiDrafts = pgTable(
  "macro_ai_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    question: text("question").notNull(),
    body: text("body").notNull(),
    model: text("model").notNull(),
    costUsd: numeric("cost_usd", { precision: 10, scale: 5 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("macro_ai_drafts_org_key").on(t.orgId, t.key)],
);

// Which macro a sent reply started from, with the macro's text at that
// moment. Lets Flatdesk see how the team edits a macro before sending it
// (lib/macro-drift.ts).
export const macroUses = pgTable(
  "macro_uses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    macroId: uuid("macro_id").notNull().references(() => macros.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
    macroBody: text("macro_body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("macro_uses_org_macro").on(t.orgId, t.macroId, t.createdAt)],
);

// Macro updates an admin chose not to apply, by the edit they describe, so the
// same edit isn't proposed again. A different edit to the same macro still is.
export const macroUpdateDismissals = pgTable(
  "macro_update_dismissals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    macroId: uuid("macro_id").notNull().references(() => macros.id, { onDelete: "cascade" }),
    signature: text("signature").notNull(),
    userId: text("user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("macro_update_dismissals_macro_sig").on(t.macroId, t.signature)],
);

// The evolving knowledge log (lib/learn.ts). A "run" row is one daily pass
// over a team's solved tickets: the tickets it read and what it cost. The
// other kinds record what that pass changed: a saved answer added, updated or
// retired, or a team macro flagged as out of date. "removed" is a learned
// answer someone on the team deleted, so it isn't learned again.
export const aiLearningKind = pgEnum("ai_learning_kind", ["run", "added", "updated", "retired", "flagged", "removed"]);
export const aiLearning = pgTable(
  "ai_learning",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    kind: aiLearningKind("kind").notNull(),
    macroId: uuid("macro_id").references(() => macros.id, { onDelete: "set null" }),
    name: text("name").notNull().default(""),
    detail: text("detail").notNull().default(""),
    ticketIds: uuid("ticket_ids").array().notNull().default(sql`'{}'::uuid[]`),
    model: text("model"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 5 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_learning_org_created").on(t.orgId, t.createdAt)],
);

// The agent copilot: summaries, drafted replies and rewrites an agent asks
// for on a ticket. Included in the seat under a fair-use limit (lib/copilot.ts),
// never counted toward the AI allowance. A summary row doubles as its cache,
// keyed by the last message it read.
export const copilotKind = pgEnum("copilot_kind", ["summary", "draft", "rewrite", "translate"]);
export const copilotEvents = pgTable(
  "copilot_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id").references(() => tickets.id, { onDelete: "set null" }),
    userId: text("user_id").notNull(),
    kind: copilotKind("kind").notNull(),
    month: text("month").notNull(), // "2026-09", in UTC
    lastMessageId: uuid("last_message_id"),
    output: text("output"),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 5 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("copilot_events_org_month").on(t.orgId, t.month), index("copilot_events_ticket").on(t.ticketId, t.kind)],
);

export const testDriveStatus = pgEnum("test_drive_status", ["queued", "running", "done", "failed", "skipped"]);
export const testDriveVerdict = pgEnum("test_drive_verdict", ["send", "edit", "wrong"]);

// The AI test drive: the AI drafts an answer to one of the team's past
// tickets, shown beside the reply the team actually sent. Drafts are never
// sent and never count toward the AI allowance. See lib/test-drive.ts.
export const testDriveDrafts = pgTable(
  "test_drive_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
    status: testDriveStatus("status").notNull().default("queued"),
    decision: text("decision"), // "answer" or "handoff"
    draft: text("draft"),
    reason: text("reason"),
    sources: text("sources").array().notNull().default(sql`'{}'::text[]`),
    error: text("error"),
    model: text("model"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 5 }).notNull().default("0"),
    // How the team rated the draft against what they actually sent.
    verdict: testDriveVerdict("verdict"),
    verdictBy: text("verdict_by"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("test_drive_drafts_org_ticket").on(t.orgId, t.ticketId), index("test_drive_drafts_org_status").on(t.orgId, t.status)],
);

// Who changed what, for admins: settings, seats, exports, imports, refunds.
// Kept as long as the team's account; shown at /app/settings/audit.
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    actorId: text("actor_id"), // Clerk user id; null for the system
    actorName: text("actor_name").notNull(),
    action: text("action").notNull(), // e.g. "settings.ai", "export.archive"
    detail: text("detail").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_events_org_time").on(t.orgId, t.createdAt)],
);

export const waitlist = pgTable("waitlist", {
  email: text("email").primaryKey(),
  currentTool: text("current_tool"),
  agents: integer("agents"),
  source: text("source"),
  referrer: text("referrer"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Requests for the done-for-you AI setup, from the /enterprise page. Someone
// at Flatdesk reads each one and writes back; nothing here is automated.
export const aiSetupRequests = pgTable("ai_setup_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name"),
  company: text("company"),
  agents: integer("agents"),
  monthlyTickets: integer("monthly_tickets"),
  currentTool: text("current_tool"),
  message: text("message"),
  source: text("source"),
  referrer: text("referrer"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Counters for the public endpoints (chat widget, waitlist). One row per key
// and window; rows past reset_at are reused or swept (see lib/rate-limit.ts).
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});

// ---- Import from other help desks ----------------------------------------

export const importSource = pgEnum("import_source", ["zendesk", "intercom", "freshdesk", "helpscout"]);
export const importStatus = pgEnum("import_status", ["running", "done", "failed", "cancelled"]);

export type ImportCounts = Record<string, { found: number; imported: number; kept: number }>;

export const imports = pgTable(
  "imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    source: importSource("source").notNull(),
    account: text("account").notNull(), // e.g. "acme.zendesk.com"
    // The source's own id for the account, when it has one (an Intercom
    // workspace id). Two imports with different keys are different accounts.
    accountKey: text("account_key"),
    status: importStatus("status").notNull().default("running"),
    phase: text("phase").notNull(),
    cursor: jsonb("cursor").$type<unknown>(),
    // AES-GCM encrypted API credentials, erased when the import ends.
    credentials: text("credentials"),
    counts: jsonb("counts").$type<ImportCounts>().notNull().default({}),
    // Things about the whole import worth saying (an API that doesn't expose rules).
    notes: text("notes").array().notNull().default(sql`'{}'::text[]`),
    error: text("error"),
    retryAt: timestamp("retry_at", { withTimezone: true }), // rate limited until
    lockedUntil: timestamp("locked_until", { withTimezone: true }), // one step runs at a time
    startedBy: text("started_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("imports_org_created").on(t.orgId, t.createdAt),
    // One running import per team, even when two start at the same moment.
    uniqueIndex("imports_org_running").on(t.orgId).where(sql`${t.status} = 'running'`),
  ],
);

// Every record read from the old help desk, verbatim. This is what makes an
// import lossless: whatever Flatdesk can't show yet is still here, linked to
// what it became (mappedId), with the reasons it couldn't be fully mapped.
export const importRecords = pgTable(
  "import_records",
  {
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    source: importSource("source").notNull(),
    kind: text("kind").notNull(), // agent, group, field, tag, macro, rule, contact, company, ticket
    externalId: text("external_id").notNull(),
    importId: uuid("import_id").notNull().references(() => imports.id, { onDelete: "cascade" }),
    label: text("label"), // human name for reports: macro name, ticket subject
    mappedId: text("mapped_id"), // Flatdesk id it became; null = kept only here
    issues: text("issues").array().notNull().default(sql`'{}'::text[]`),
    raw: jsonb("raw").notNull(),
    // Queued for the second pass (fetching a ticket's full conversation).
    pending: boolean("pending").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.source, t.kind, t.externalId] }),
    index("import_records_import").on(t.importId, t.kind),
    index("import_records_pending").on(t.importId, t.pending),
  ],
);

// Agents from the old help desk. They don't have Flatdesk accounts until
// invited; when one joins with the same email, their tickets and rules follow.
export const externalAgents = pgTable(
  "external_agents",
  {
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    source: importSource("source").notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    email: text("email"),
    role: text("role"),
    active: boolean("active").notNull().default(true),
    linkedUserId: text("linked_user_id"),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.source, t.externalId] }), index("external_agents_email").on(t.orgId, t.email)],
);

// Rules from the old help desk. Simple "tag -> assignee" rules also become
// Flatdesk rules; the rest are kept here, described in words, so the team can
// see what used to happen automatically.
export const importedRules = pgTable("imported_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  source: importSource("source").notNull(),
  externalId: text("external_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // "trigger", "automation", "workflow", ...
  activeInSource: boolean("active_in_source").notNull().default(true),
  summary: text("summary").array().notNull().default(sql`'{}'::text[]`),
  flatdeskRuleId: uuid("flatdesk_rule_id").references(() => rules.id, { onDelete: "set null" }),
  // Or, for richer rules, the Flatdesk trigger made from it.
  flatdeskTriggerId: uuid("flatdesk_trigger_id").references(() => triggers.id, { onDelete: "set null" }),
  // Tag rule waiting for its agent to join: created when they do.
  pendingTag: text("pending_tag"),
  pendingAssigneeEmail: text("pending_assignee_email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("imported_rules_org_source_ext").on(t.orgId, t.source, t.externalId)]);

// ---- Integrations ----------------------------------------------------------

// Keys for the REST API at /api/v1 (lib/api-keys.ts). Only a SHA-256 hash of
// the key is stored; the key itself is shown once, when it's made.
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(), // the first characters, so people can tell keys apart
    hash: text("hash").notNull().unique(),
    // Replies sent with this key are signed by this person unless the request names another agent.
    createdBy: text("created_by").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("api_keys_org").on(t.orgId)],
);

export const integrationKind = pgEnum("integration_kind", ["shopify", "stripe", "hubspot", "jira", "slack", "gmail", "microsoft"]);

// Accounts connected to the team's tickets: Shopify orders, Stripe payments
// and HubSpot contacts shown beside a ticket, and the Jira project tickets are
// escalated to (lib/integrations/). Credentials are encrypted.
export type IntegrationSettings = {
  // HubSpot: log each closed ticket on the contact's timeline, for tickets closed from logSince on.
  logClosed?: boolean;
  logSince?: string;
  // HubSpot: add a contact for people who aren't in HubSpot yet, when logging their ticket.
  createContacts?: boolean;
  // Slack app: the workspace it's installed in (requests from Slack name it) and the alert channel.
  slackTeamId?: string;
  slackChannel?: string;
  // A connected mailbox (lib/mailbox/): its address, and where reading new
  // mail left off (Gmail's history id; for Microsoft, the last received time).
  mailbox?: string;
  historyId?: string;
  since?: string;
};

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    kind: integrationKind("kind").notNull(),
    account: text("account").notNull(), // "acme.myshopify.com", or the Stripe account's name
    credentials: text("credentials").notNull(), // sealed with lib/import/crypto.ts
    connectedBy: text("connected_by").notNull(),
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    // What the team turned on for this connection, like HubSpot write-back (lib/integrations/hubspot-sync.ts).
    settings: jsonb("settings").$type<IntegrationSettings>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("integrations_org_kind").on(t.orgId, t.kind)],
);

// Things a ticket was escalated to, like a Jira issue. The issue's status is
// read live when the ticket is opened.
export const ticketLinks = pgTable(
  "ticket_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
    kind: integrationKind("kind").notNull(),
    externalKey: text("external_key").notNull(), // "SUP-123"
    url: text("url").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ticket_links_ticket").on(t.ticketId), uniqueIndex("ticket_links_org_kind_key").on(t.orgId, t.kind, t.externalKey)],
);

export const aiActionKind = pgEnum("ai_action_kind", ["webhook", "stripe_refund", "stripe_cancel", "shopify_cancel"]);
// always: a person approves every run. over_limit: runs on its own up to
// limitCents, above that a person approves. never: runs on its own.
export const aiActionApproval = pgEnum("ai_action_approval", ["always", "over_limit", "never"]);

export type AiActionInput = { name: string; description: string };

// Things the AI may do for a customer while answering: refund a Stripe
// payment, cancel a subscription or a Shopify order, or call the team's own
// endpoint (reset a password, change a plan, look up an account). See
// lib/ai-actions.ts. The built-in kinds are one per team.
export const aiActions = pgTable(
  "ai_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    kind: aiActionKind("kind").notNull(),
    name: text("name").notNull(),
    whenToUse: text("when_to_use").notNull().default(""),
    inputs: jsonb("inputs").$type<AiActionInput[]>().notNull().default([]),
    url: text("url"), // webhook only
    // Signs webhook calls (X-Flatdesk-Signature), like the alert secret.
    secret: text("secret").notNull().default(sql`replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')`),
    // A webhook that only looks something up: it runs straight away and its
    // answer goes back to the AI. Never needs approval.
    lookup: boolean("lookup").notNull().default(false),
    approval: aiActionApproval("approval").notNull().default("always"),
    limitCents: integer("limit_cents"),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_actions_org").on(t.orgId), uniqueIndex("ai_actions_org_builtin").on(t.orgId, t.kind).where(sql`${t.kind} <> 'webhook'`)],
);

export const aiActionRunStatus = pgEnum("ai_action_run_status", ["waiting", "done", "failed", "declined"]);

// Each time the AI used an action on a ticket. "waiting" runs need a person
// to approve them; the AI's reply is held in `reply` until they do.
export const aiActionRuns = pgTable(
  "ai_action_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
    actionId: uuid("action_id").references(() => aiActions.id, { onDelete: "set null" }),
    kind: aiActionKind("kind").notNull(),
    actionName: text("action_name").notNull(),
    inputs: jsonb("inputs").$type<Record<string, string>>().notNull().default({}),
    summary: text("summary").notNull(), // "Refund 12.00 USD of the 54.00 USD payment on 2026-09-01"
    amountCents: integer("amount_cents"),
    status: aiActionRunStatus("status").notNull(),
    reply: text("reply").notNull().default(""),
    result: text("result"),
    aiEventId: uuid("ai_event_id"),
    // The ticket was already answered by the AI when this run started.
    followUp: boolean("follow_up").notNull().default(false),
    decidedBy: text("decided_by"),
    decidedByName: text("decided_by_name"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_action_runs_ticket").on(t.ticketId), index("ai_action_runs_org_status").on(t.orgId, t.status)],
);

// Who has a ticket open right now, and whether they're writing a reply, so
// two people don't answer the same customer. Rows older than a minute are
// stale and ignored (lib/presence.ts).
export const ticketPresence = pgTable(
  "ticket_presence",
  {
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    typing: boolean("typing").notNull().default(false),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ticket_presence_ticket_user").on(t.ticketId, t.userId)],
);

// Teammates following a ticket (lib/followers.ts): they're emailed when the
// customer writes back or someone else replies, without being the assignee.
export const ticketFollowers = pgTable(
  "ticket_followers",
  {
    ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(), // agents.user_id within the same org
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ticketId, t.userId] }), index("ticket_followers_org_user").on(t.orgId, t.userId)],
);

// Groups of agents (Billing, Tier 2...). A ticket can belong to one; with
// shareInTurn its tickets go to the members in turn (lib/routing.ts).
export const groups = pgTable(
  "groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    shareInTurn: boolean("share_in_turn").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("groups_org_name").on(t.orgId, t.name)],
);

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] }), index("group_members_org_user").on(t.orgId, t.userId)],
);

// AI insights: what customers asked about over a window, grouped into topics
// (lib/insights.ts). The latest run per team is shown on Reports.
export type InsightTopic = { name: string; summary: string; ticketIds: string[]; gap: string; suggestion: string };
export const insights = pgTable(
  "insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    days: integer("days").notNull(),
    tickets: integer("tickets").notNull(),
    topics: jsonb("topics").$type<InsightTopic[]>().notNull().default([]),
    notes: jsonb("notes").$type<string[]>().notNull().default([]),
    createdBy: text("created_by").notNull(),
    model: text("model"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 5 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("insights_org_created").on(t.orgId, t.createdAt)],
);

// AI triage of a new ticket (lib/triage.ts): one row per ticket, so a ticket
// is never triaged twice. `applied` is what was changed, for the note and reports.
export type TriageApplied = { priority?: "low" | "normal" | "high" | "urgent"; tags?: string[]; groupId?: string };
export const aiTriage = pgTable(
  "ai_triage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
    month: text("month").notNull(), // "2026-10", in UTC
    applied: jsonb("applied").$type<TriageApplied>(),
    reason: text("reason"),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 5 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ai_triage_ticket").on(t.ticketId), index("ai_triage_org_month").on(t.orgId, t.month)],
);

// Websites the AI reads (lib/web-knowledge.ts): a team adds its site or docs
// address, Flatdesk reads up to WEB.maxPages pages under it, and the AI answers
// from them like saved answers. Read again weekly.
export const webSourceStatus = pgEnum("web_source_status", ["reading", "ready", "failed"]);
export const webSources = pgTable(
  "web_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    status: webSourceStatus("status").notNull().default("reading"),
    error: text("error"),
    pageCount: integer("page_count").notNull().default(0),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("web_sources_org_url").on(t.orgId, t.url)],
);
export const webPages = pgTable(
  "web_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").notNull().references(() => webSources.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title").notNull(),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("web_pages_source_url").on(t.sourceId, t.url), index("web_pages_org").on(t.orgId)],
);

// Custom ticket fields a team defines (lib/ticket-fields.ts). Values live in
// tickets.fields under the field's name, beside fields kept from an import,
// so an imported "Plan" fills a "Plan" field defined later.
export const ticketFieldKind = pgEnum("ticket_field_kind", ["text", "number", "dropdown", "checkbox"]);
export const ticketFields = pgTable(
  "ticket_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: ticketFieldKind("kind").notNull().default("text"),
    options: text("options").array().notNull().default(sql`'{}'::text[]`), // dropdown choices
    // A ticket can't be closed by someone on the team until this is filled in.
    requiredToClose: boolean("required_to_close").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ticket_fields_org_name").on(t.orgId, t.name)],
);

// Saved inbox views (lib/saved-views.ts): a person's own, or shared with the
// team when ownerId is null.
export type ViewFilters = {
  status?: "open" | "pending" | "closed" | "active"; // active: open or pending
  assignee?: string; // "me", "unassigned", or an agents.user_id
  groupId?: string; // a groups.id, or "mine" for the person's groups
  priorities?: ("urgent" | "high" | "normal" | "low")[];
  tags?: string[]; // any of
  channel?: "email" | "chat";
  field?: { name: string; value: string };
};
export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    ownerId: text("owner_id"), // agents.user_id; null = shared with the team
    createdBy: text("created_by").notNull(),
    name: text("name").notNull(),
    filters: jsonb("filters").$type<ViewFilters>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("saved_views_org").on(t.orgId)],
);

// Replies an agent scheduled to go out later (lib/scheduled-replies.ts). The
// sla cron sends the ones that are due; one is held instead when the customer
// wrote again in the meantime, so a stale answer never goes out on its own.
export const scheduledReplyStatus = pgEnum("scheduled_reply_status", ["scheduled", "sent", "held", "cancelled"]);
export const scheduledReplies = pgTable(
  "scheduled_replies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(), // agents.user_id: who wrote it, and whose signature it gets
    body: text("body").notNull(),
    original: text("original"), // what they wrote, when the body was translated for the customer
    status: scheduledReplyStatus("status").notNull().default("scheduled"),
    nextStatus: ticketStatus("next_status").notNull().default("pending"),
    addTags: text("add_tags").array().notNull().default(sql`'{}'::text[]`),
    assignTo: text("assign_to"),
    macroIds: uuid("macro_ids").array().notNull().default(sql`'{}'::uuid[]`),
    sendAt: timestamp("send_at", { withTimezone: true }).notNull(),
    heldReason: text("held_reason"),
    messageId: uuid("message_id"), // the reply once it was sent
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("scheduled_replies_due").on(t.status, t.sendAt), index("scheduled_replies_ticket").on(t.ticketId)],
);
