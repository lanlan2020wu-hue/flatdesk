import { sql } from "drizzle-orm";
import {
  boolean,
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
  aiNoticeLevel: integer("ai_notice_level").notNull().default(0),
  // Stripe billing. One subscription per org, quantity = seats (Clerk members).
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionStatus: text("subscription_status"), // Stripe's status: trialing, active, past_due, canceled...
  billedSeats: integer("billed_seats"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  overageBilledMonth: text("overage_billed_month"), // last month whose AI overage was added to an invoice
  nextTicketNumber: integer("next_ticket_number").notNull().default(1),
  // Customers' email reaches the org at <inboundKey>@INBOUND_DOMAIN. Teams
  // forward their own support address there.
  inboundKey: text("inbound_key").notNull().unique().default(sql`substr(md5(random()::text), 1, 10)`),
  // Public id in the website chat widget's embed code.
  widgetKey: text("widget_key").notNull().unique().default(sql`substr(md5(random()::text), 1, 12)`),
  // The team's public support address (support@theircompany.com), entered
  // during onboarding. Used for the end-to-end test email.
  supportEmail: text("support_email"),
  onboarding: jsonb("onboarding").$type<Onboarding>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Progress through the new-team checklist at /app/welcome. Most steps are
// also detected from real data (a forwarded email arrived, an import ran).
export type Onboarding = {
  skipped?: OnboardingStep[];
  dismissed?: boolean;
  invited?: string[]; // emails invited from the checklist
  forwardingConfirmed?: boolean; // the admin said forwarding is set up
  gmailConfirmation?: { code: string | null; link: string | null; receivedAt: string };
  testToken?: string; // subject token of the end-to-end test email
  testSentAt?: string;
};
export type OnboardingStep = "invite" | "inbox" | "import" | "test";

export const agentRole = pgEnum("agent_role", ["admin", "agent"]);

export const agents = pgTable(
  "agents",
  {
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(), // Clerk user id
    name: text("name").notNull(),
    email: text("email").notNull(),
    role: agentRole("role").notNull().default("agent"),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("customers_org_email").on(t.orgId, t.email)],
);

export const ticketStatus = pgEnum("ticket_status", ["open", "pending", "closed"]);
export const channel = pgEnum("channel", ["email", "chat"]);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    number: integer("number").notNull(), // shown to people as #1042, unique per org
    subject: text("subject").notNull(),
    status: ticketStatus("status").notNull().default("open"),
    channel: channel("channel").notNull(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    assigneeId: text("assignee_id"), // agents.user_id within the same org
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
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
    closedAt: timestamp("closed_at", { withTimezone: true }),
    resolvedByAi: boolean("resolved_by_ai").notNull().default(false),
    // Chat tickets: the visitor's browser holds this to read and continue the thread.
    visitorToken: text("visitor_token"),
  },
  (t) => [
    uniqueIndex("tickets_org_number").on(t.orgId, t.number),
    index("tickets_org_status_updated").on(t.orgId, t.status, t.updatedAt),
    index("tickets_org_assignee").on(t.orgId, t.assigneeId),
    // Makes imports safe to re-run: a ticket already imported is skipped.
    uniqueIndex("tickets_org_external").on(t.orgId, t.externalId),
  ],
);

export const authorType = pgEnum("author_type", ["customer", "agent", "ai", "system"]);

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("messages_ticket_created").on(t.ticketId, t.createdAt),
    index("messages_org_email_message_id").on(t.orgId, t.emailMessageId),
    index("messages_ticket_external").on(t.ticketId, t.externalId),
  ],
);

export const macros = pgTable("macros", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  body: text("body").notNull(),
  addTags: text("add_tags").array().notNull().default(sql`'{}'::text[]`),
  setStatus: ticketStatus("set_status"), // null = leave status unchanged
  source: text("source"),
  externalId: text("external_id"),
  // Actions from the original macro that Flatdesk can't perform, in words
  // ("Set priority to High"). Shown on the macro so nothing is silently lost.
  notApplied: text("not_applied").array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// v1 rules are deliberately narrow: "when a ticket has tag X, assign it to Y".
export const rules = pgTable("rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  ifTag: text("if_tag").notNull(),
  assignTo: text("assign_to").notNull(), // agents.user_id
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// "refunded": an admin marked a resolution as wrong on the receipts page, so it no longer counts.
export const aiEventKind = pgEnum("ai_event_kind", ["resolution", "draft", "handoff", "refunded"]);

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_events_org_month").on(t.orgId, t.month, t.kind)],
);

export const waitlist = pgTable("waitlist", {
  email: text("email").primaryKey(),
  currentTool: text("current_tool"),
  agents: integer("agents"),
  source: text("source"),
  referrer: text("referrer"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  (t) => [index("imports_org_created").on(t.orgId, t.createdAt)],
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
  // Tag rule waiting for its agent to join: created when they do.
  pendingTag: text("pending_tag"),
  pendingAssigneeEmail: text("pending_assignee_email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("imported_rules_org_source_ext").on(t.orgId, t.source, t.externalId)]);
