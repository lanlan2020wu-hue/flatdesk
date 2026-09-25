import { sql } from "drizzle-orm";
import {
  boolean,
  index,
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
    externalId: text("external_id"), // "zendesk:<id>" for imported tickets
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
    body: text("body").notNull(),
    internal: boolean("internal").notNull().default(false), // internal notes never reach the customer
    emailMessageId: text("email_message_id"), // Message-ID header, for threading replies
    deliveryError: text("delivery_error"), // set when an outbound email failed to send
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("messages_ticket_created").on(t.ticketId, t.createdAt),
    index("messages_org_email_message_id").on(t.orgId, t.emailMessageId),
  ],
);

export const macros = pgTable("macros", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  body: text("body").notNull(),
  addTags: text("add_tags").array().notNull().default(sql`'{}'::text[]`),
  setStatus: ticketStatus("set_status"), // null = leave status unchanged
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

export const aiEventKind = pgEnum("ai_event_kind", ["resolution", "draft", "handoff"]);

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
