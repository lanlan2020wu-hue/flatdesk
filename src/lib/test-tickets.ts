import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { noNul } from "@/lib/ids";
import { addCustomerMessage, createTicket, normalizeTags, parseTicketNumber } from "@/lib/tickets";

// Test tickets: an admin plays the customer to see what Flatdesk does with a
// situation. A test ticket goes through the same steps as a real one (rules,
// the AI, the reply email, alerts, the reply target), with these differences:
// - the customer is the admin's own email address, so replies land in their inbox
// - it says "Test" wherever it shows, and alerts say "test ticket"
// - it's left out of reports, the AI allowance, the bill, receipts and the test drive
// - the AI on it is paid from a small monthly budget (TEST_AI_BUDGET_USD in lib/ai.ts)
// - all of them go in one click

const { tickets, messages, aiEvents, agents, customers, rules } = schema;

export class TestTicketError extends Error {}

export type Scenario = {
  id: string;
  label: string;
  expect: string; // what a team should see happen
  channel: "email" | "chat";
  name: string;
  subject: string;
  body: string;
  tags?: string[];
};

export const SCENARIOS: Scenario[] = [
  {
    id: "question",
    label: "Common question",
    expect: "The AI answers if your macros or help articles cover it. Otherwise it hands the ticket to your team.",
    channel: "email",
    name: "Sam Rivera",
    subject: "How do I reset my password?",
    body: "Hi, I can't remember my password and the login page isn't helping. How do I reset it?\n\nThanks,\nSam",
  },
  {
    id: "refund",
    label: "Refund request",
    expect: "The AI never handles money, so it hands this to your team with a note saying why.",
    channel: "email",
    name: "Priya Shah",
    subject: "Charged twice this month",
    body: "Hello, I was charged twice for my subscription this month. Can you refund the extra charge?\n\nPriya",
  },
  {
    id: "upset",
    label: "Upset customer on chat",
    expect: "The AI hands it to your team, and an alert goes out if you set one up in Settings.",
    channel: "chat",
    name: "Jordan Lee",
    subject: "This is the third time I've asked",
    body: "This is the third time I've asked about my order and nobody has answered. I want to talk to a person.",
  },
  {
    id: "routed",
    label: "Tagged for a rule",
    expect: "Gets the tag of your first assignment rule, so you can see who it goes to.",
    channel: "email",
    name: "Alex Kim",
    subject: "Question about my invoice",
    body: "Hi, the invoice for last month shows the wrong company name. Can it be corrected?\n\nAlex",
    tags: ["billing"],
  },
];

// How long ago the test ticket pretends to have arrived, to see the reply target at work.
export const AGES = [
  { id: "now", label: "Just now", minutes: 0 },
  { id: "3h", label: "3 hours ago", minutes: 180 },
  { id: "1d", label: "1 day ago", minutes: 1440 },
] as const;

const EMAIL = /^[^\s@<>"(),;:]+@[^\s@<>"(),;:]+\.[^\s@<>"(),;:]+$/;

// The customer is always the admin: their own address, or a plus version of it
// (you+refund@example.com) to play a different customer. Flatdesk emails the
// customer for real, so this never lets anyone send to a stranger.
export function allowedCustomerEmail(own: string, raw: string): string | null {
  const email = noNul(raw).trim().toLowerCase();
  const me = own.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254 || !EMAIL.test(me)) return null;
  const [local, domain] = email.split("@");
  const [myLocal, myDomain] = me.split("@");
  if (domain !== myDomain) return null;
  return local === myLocal || local.startsWith(`${myLocal}+`) ? email : null;
}

export async function ownEmail(orgId: string, userId: string) {
  const me = await db.query.agents.findFirst({ where: and(eq(agents.orgId, orgId), eq(agents.userId, userId)), columns: { email: true } });
  return me?.email ?? "";
}

export type TestInput = {
  channel: "email" | "chat";
  email: string;
  name: string;
  subject: string;
  body: string;
  tags: string[];
  ageMinutes: number;
};

// Reads the form on /app/test-tickets, filling in a scenario's text.
export function parseTestForm(form: FormData, own: string): TestInput {
  const get = (k: string) => noNul(String(form.get(k) ?? "")).trim();
  const scenario = SCENARIOS.find((s) => s.id === get("scenario"));
  const channel = (scenario?.channel ?? get("channel")) === "chat" ? "chat" : "email";
  // Each ready-made customer gets their own plus address, so their name and history stay apart.
  const email = allowedCustomerEmail(own, get("email") || (scenario ? own.replace("@", `+${scenario.id}@`) : own));
  if (!email) throw new TestTicketError(`Use your own email (${own || "not known yet"}) or a plus version of it, like ${own.replace("@", "+test@")}. Flatdesk emails the customer for real.`);
  const subject = (scenario?.subject ?? get("subject")).slice(0, 200);
  const body = (scenario?.body ?? get("body")).slice(0, 5000);
  if (!subject || !body) throw new TestTicketError("Write a subject and a message, or pick a ready-made situation.");
  const tags = normalizeTags([...(scenario?.tags ?? []), ...get("tags").split(",")]);
  const age = AGES.find((a) => a.id === get("age")) ?? AGES[0];
  return { channel, email, name: (scenario?.name ?? get("name")).slice(0, 120), subject, body, tags, ageMinutes: age.minutes };
}

// Makes the ticket as if the customer had written in. The caller runs the AI
// and alerts afterwards, as the email and chat routes do.
export async function createTestTicket(orgId: string, input: TestInput, scenarioId?: string) {
  let tags = input.tags;
  // "Tagged for a rule" uses the team's own first rule when there is one.
  if (scenarioId === "routed") {
    const [rule] = await db.select({ tag: rules.ifTag }).from(rules).where(and(eq(rules.orgId, orgId), eq(rules.enabled, true))).orderBy(asc(rules.createdAt)).limit(1);
    if (rule) tags = normalizeTags([rule.tag, ...tags.filter((t) => t !== "billing")]);
  }
  const ticket = await createTicket({
    orgId,
    channel: input.channel,
    customerEmail: input.email,
    customerName: input.name || null,
    subject: input.subject,
    body: input.body,
    authorType: "customer",
    tags,
    test: true,
  });
  if (input.ageMinutes > 0) {
    const at = new Date(Date.now() - input.ageMinutes * 60_000);
    await db.update(tickets).set({ createdAt: at, updatedAt: at }).where(and(eq(tickets.orgId, orgId), eq(tickets.id, ticket.id)));
    await db.update(messages).set({ createdAt: at }).where(and(eq(messages.orgId, orgId), eq(messages.id, ticket.messageId)));
  }
  return ticket;
}

async function testTicket(orgId: string, raw: string | number) {
  const number = parseTicketNumber(raw);
  if (!number) return null;
  const t = await db.query.tickets.findFirst({ where: and(eq(tickets.orgId, orgId), eq(tickets.number, number), eq(tickets.test, true)) });
  return t ?? null;
}

// The customer writes again on a test ticket, as an email reply would.
export async function customerWritesBack(orgId: string, raw: string | number, text: string) {
  const ticket = await testTicket(orgId, raw);
  if (!ticket) throw new TestTicketError("That test ticket is gone.");
  const body = noNul(text).trim().slice(0, 5000);
  if (!body) throw new TestTicketError("Write what the customer says.");
  await addCustomerMessage({ orgId, ticketId: ticket.id, customerId: ticket.customerId, body });
  return ticket;
}

// Deletes every test ticket and what hangs off it (messages, files, ratings).
// Their AI spend stays on record, so clearing doesn't reset the test budget.
export async function clearTestTickets(orgId: string) {
  const gone = await db.delete(tickets).where(and(eq(tickets.orgId, orgId), eq(tickets.test, true))).returning({ id: tickets.id });
  return gone.length;
}

export type TestRow = {
  number: number;
  subject: string;
  channel: string;
  status: string;
  customer: string;
  tags: string[];
  assignee: string | null;
  createdAt: Date;
  firstResponseAt: Date | null;
  source: string | null;
  resolvedByAi: boolean;
  messages: number;
  ai: { kind: string; reason: string | null; sources: string[] } | null;
  note: string | null; // Flatdesk's latest note: why the AI didn't answer, and so on
  emailError: string | null;
};

export async function listTestTickets(orgId: string): Promise<TestRow[]> {
  const rows = await db
    .select({ ticket: tickets, customerEmail: customers.email, customerName: customers.name, assignee: agents.name })
    .from(tickets)
    .innerJoin(customers, eq(customers.id, tickets.customerId))
    .leftJoin(agents, and(eq(agents.orgId, tickets.orgId), eq(agents.userId, tickets.assigneeId)))
    .where(and(eq(tickets.orgId, orgId), eq(tickets.test, true)))
    .orderBy(desc(tickets.number))
    .limit(50);
  const ids = rows.map((r) => r.ticket.id);
  if (!ids.length) return [];
  const [events, thread] = await Promise.all([
    db.select().from(aiEvents).where(and(eq(aiEvents.orgId, orgId), inArray(aiEvents.ticketId, ids))).orderBy(desc(aiEvents.createdAt)),
    db
      .select({ ticketId: messages.ticketId, authorType: messages.authorType, body: messages.body, deliveryError: messages.deliveryError })
      .from(messages)
      .where(and(eq(messages.orgId, orgId), inArray(messages.ticketId, ids)))
      .orderBy(sql`${messages.createdAt} desc`),
  ]);
  return rows.map(({ ticket: t, customerEmail, customerName, assignee }) => {
    const mine = thread.filter((m) => m.ticketId === t.id);
    const e = events.find((x) => x.ticketId === t.id);
    return {
      number: t.number,
      subject: t.subject,
      channel: t.channel,
      status: t.status,
      customer: customerName ? `${customerName} (${customerEmail})` : customerEmail,
      tags: t.tags,
      assignee,
      createdAt: t.createdAt,
      firstResponseAt: t.firstResponseAt,
      source: t.source,
      resolvedByAi: t.resolvedByAi,
      messages: mine.filter((m) => m.authorType !== "system").length,
      ai: e ? { kind: e.kind, reason: e.reason, sources: e.sources } : null,
      note: mine.find((m) => m.authorType === "system")?.body ?? null,
      emailError: mine.find((m) => m.deliveryError)?.deliveryError ?? null,
    };
  });
}

export async function testAiSpent(orgId: string, month: string) {
  const [{ spent }] = await db
    .select({ spent: sql<string>`coalesce(sum(${aiEvents.costUsd}), 0)` })
    .from(aiEvents)
    .where(and(eq(aiEvents.orgId, orgId), eq(aiEvents.test, true), eq(aiEvents.month, month)));
  return Number(spent);
}
