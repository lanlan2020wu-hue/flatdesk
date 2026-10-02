import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { noNul } from "@/lib/ids";

const { tickets, messages, customers, agents, rules, orgs } = schema;

export type TicketStatus = (typeof schema.ticketStatus.enumValues)[number];
export type View = "mine" | "unassigned" | "open" | "pending" | "closed";

export const VIEWS: { id: View; label: string }[] = [
  { id: "mine", label: "Assigned to me" },
  { id: "unassigned", label: "Unassigned" },
  { id: "open", label: "All open" },
  { id: "pending", label: "Pending" },
  { id: "closed", label: "Closed" },
];

export function isView(v: unknown): v is View {
  return VIEWS.some((x) => x.id === v);
}

// Ticket numbers come from URLs and email addresses. Anything that isn't a
// positive whole number Postgres can store as an integer is no ticket, rather
// than a query that throws.
const MAX_TICKET_NUMBER = 2_147_483_647;
export function parseTicketNumber(raw: string | number | null | undefined): number | null {
  const s = String(raw ?? "").trim();
  if (!/^\d{1,10}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= MAX_TICKET_NUMBER ? n : null;
}

export async function listTickets(orgId: string, userId: string, view: View) {
  const where = [eq(tickets.orgId, orgId)];
  if (view === "mine") where.push(eq(tickets.assigneeId, userId), inArray(tickets.status, ["open", "pending"]));
  if (view === "unassigned") where.push(isNull(tickets.assigneeId), eq(tickets.status, "open"));
  if (view === "open" || view === "pending" || view === "closed") where.push(eq(tickets.status, view));

  return db
    .select({
      id: tickets.id,
      number: tickets.number,
      subject: tickets.subject,
      status: tickets.status,
      channel: tickets.channel,
      tags: tickets.tags,
      updatedAt: tickets.updatedAt,
      createdAt: tickets.createdAt,
      firstResponseAt: tickets.firstResponseAt,
      source: tickets.source,
      test: tickets.test,
      assigneeId: tickets.assigneeId,
      assigneeName: agents.name,
      customerName: customers.name,
      customerEmail: customers.email,
      // The latest message the customer can see, for the row's one-line preview.
      preview: sql<string | null>`(select left(${messages.body}, 200) from ${messages} where ${messages.ticketId} = ${tickets.id} and ${messages.internal} = false and ${messages.authorType} <> 'system' order by ${messages.createdAt} desc limit 1)`,
    })
    .from(tickets)
    .innerJoin(customers, eq(customers.id, tickets.customerId))
    .leftJoin(agents, and(eq(agents.orgId, tickets.orgId), eq(agents.userId, tickets.assigneeId)))
    .where(and(...where))
    .orderBy(view === "closed" ? desc(tickets.updatedAt) : asc(tickets.updatedAt))
    .limit(200);
}

export async function viewCounts(orgId: string, userId: string) {
  const [row] = await db
    .select({
      mine: sql<number>`count(*) filter (where ${tickets.assigneeId} = ${userId} and ${tickets.status} in ('open','pending'))`,
      unassigned: sql<number>`count(*) filter (where ${tickets.assigneeId} is null and ${tickets.status} = 'open')`,
      open: sql<number>`count(*) filter (where ${tickets.status} = 'open')`,
      pending: sql<number>`count(*) filter (where ${tickets.status} = 'pending')`,
    })
    .from(tickets)
    .where(eq(tickets.orgId, orgId));
  return {
    mine: Number(row.mine),
    unassigned: Number(row.unassigned),
    open: Number(row.open),
    pending: Number(row.pending),
    closed: null,
  } satisfies Record<View, number | null>;
}

export async function getTicket(orgId: string, number: number) {
  const [row] = await db
    .select({ ticket: tickets, customer: customers })
    .from(tickets)
    .innerJoin(customers, eq(customers.id, tickets.customerId))
    .where(and(eq(tickets.orgId, orgId), eq(tickets.number, number)));
  if (!row) return null;
  const thread = await db
    .select({
      id: messages.id,
      authorType: messages.authorType,
      authorId: messages.authorId,
      authorName: messages.authorName,
      body: messages.body,
      internal: messages.internal,
      deliveryError: messages.deliveryError,
      createdAt: messages.createdAt,
      agentName: agents.name,
    })
    .from(messages)
    .leftJoin(agents, and(eq(agents.orgId, messages.orgId), eq(agents.userId, messages.authorId)))
    .where(and(eq(messages.orgId, orgId), eq(messages.ticketId, row.ticket.id)))
    .orderBy(asc(messages.createdAt));
  return { ...row, thread };
}

// The team as it is now: people removed in Clerk are left out.
export async function listAgents(orgId: string) {
  return db.select().from(agents).where(and(eq(agents.orgId, orgId), isNull(agents.removedAt))).orderBy(asc(agents.name));
}

type NewTicket = {
  orgId: string;
  visitorToken?: string; // chat: lets the visitor's browser read the conversation
  channel: "email" | "chat";
  customerEmail: string;
  customerName?: string | null;
  subject: string;
  body: string;
  authorType: "customer" | "agent";
  authorId?: string | null;
  tags?: string[];
  emailMessageId?: string | null;
  test?: boolean;
};

export async function createTicket(raw: NewTicket) {
  const input = {
    ...raw,
    customerEmail: noNul(raw.customerEmail),
    customerName: raw.customerName ? noNul(raw.customerName) : raw.customerName,
    subject: noNul(raw.subject),
    body: noNul(raw.body),
    emailMessageId: raw.emailMessageId ? noNul(raw.emailMessageId) : raw.emailMessageId,
  };
  return db.transaction(async (tx) => {
    const [customer] = await tx
      .insert(customers)
      .values({ orgId: input.orgId, email: input.customerEmail.toLowerCase(), name: input.customerName || null })
      .onConflictDoUpdate({
        target: [customers.orgId, customers.email],
        // Fills in a missing name but never renames a known customer: anyone can
        // start a chat with someone else's email address.
        set: { name: sql`coalesce(${customers.name}, excluded.name)` },
      })
      .returning();

    const [{ number }] = await tx
      .update(orgs)
      .set({ nextTicketNumber: sql`${orgs.nextTicketNumber} + 1` })
      .where(eq(orgs.id, input.orgId))
      .returning({ number: sql<number>`${orgs.nextTicketNumber} - 1` });

    const tags = normalizeTags(input.tags ?? []);
    const assigneeId = await ruleAssignee(tx, input.orgId, tags);
    const [ticket] = await tx
      .insert(tickets)
      .values({
        orgId: input.orgId,
        number,
        subject: input.subject,
        channel: input.channel,
        customerId: customer.id,
        tags,
        assigneeId,
        visitorToken: input.visitorToken ?? null,
        test: input.test ?? false,
      })
      .returning();

    const [message] = await tx
      .insert(messages)
      .values({
        orgId: input.orgId,
        ticketId: ticket.id,
        authorType: input.authorType,
        authorId: input.authorType === "customer" ? customer.id : input.authorId,
        body: input.body,
        emailMessageId: input.emailMessageId ?? null,
      })
      .returning({ id: messages.id });
    return { ...ticket, messageId: message.id };
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// v1 rules: the first enabled rule whose tag is on the ticket decides the
// assignee. A rule pointing at someone who is now a viewer is skipped, since
// viewers can't reply to the tickets it would give them.
async function ruleAssignee(tx: Tx | typeof db, orgId: string, tags: string[]): Promise<string | null> {
  if (tags.length === 0) return null;
  const [rule] = await tx
    .select({ assignTo: rules.assignTo })
    .from(rules)
    .innerJoin(agents, and(eq(agents.orgId, rules.orgId), eq(agents.userId, rules.assignTo), eq(agents.viewer, false), isNull(agents.removedAt)))
    .where(and(eq(rules.orgId, orgId), eq(rules.enabled, true), inArray(rules.ifTag, tags)))
    .orderBy(asc(rules.createdAt))
    .limit(1);
  return rule?.assignTo ?? null;
}

export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 50)).filter(Boolean))].slice(0, 20);
}

export async function addReply(opts: {
  orgId: string;
  ticketId: string;
  userId: string;
  body: string;
  internal: boolean;
  status?: TicketStatus | null;
  addTags?: string[];
  assignTo?: string | null; // from a macro; wins over assignment rules
  hasFiles?: boolean; // a reply can be only attachments
}) {
  return db.transaction(async (tx) => {
    const [ticket] = await tx
      .select()
      .from(tickets)
      .where(and(eq(tickets.orgId, opts.orgId), eq(tickets.id, opts.ticketId)))
      .for("update");
    if (!ticket) throw new Error("Ticket not found.");

    let messageId: string | null = null;
    const hasContent = Boolean(opts.body.trim()) || Boolean(opts.hasFiles);
    if (hasContent) {
      const [inserted] = await tx.insert(messages).values({
        orgId: opts.orgId,
        ticketId: ticket.id,
        authorType: "agent",
        authorId: opts.userId,
        body: opts.body.trim(),
        internal: opts.internal,
      }).returning({ id: messages.id });
      messageId = inserted.id;
    }

    const now = new Date();
    const tags = normalizeTags([...ticket.tags, ...(opts.addTags ?? [])]);
    const newTags = tags.filter((t) => !ticket.tags.includes(t));
    const status = opts.status ?? ticket.status;
    const assigneeId = opts.assignTo || ticket.assigneeId || (await ruleAssignee(tx, opts.orgId, newTags));

    await tx
      .update(tickets)
      .set({
        status,
        tags,
        assigneeId,
        updatedAt: now,
        firstResponseAt: !opts.internal && hasContent && !ticket.firstResponseAt ? now : ticket.firstResponseAt,
        closedAt: status === "closed" ? (ticket.closedAt ?? now) : null,
      })
      .where(eq(tickets.id, ticket.id));
    return { ticket, messageId };
  });
}

// A customer wrote again (usually an email reply): add it and reopen the ticket.
export async function addCustomerMessage(opts: { orgId: string; ticketId: string; customerId: string; body: string; emailMessageId?: string | null }) {
  return db.transaction(async (tx) => {
    const [message] = await tx.insert(messages).values({
      orgId: opts.orgId,
      ticketId: opts.ticketId,
      authorType: "customer",
      authorId: opts.customerId,
      body: noNul(opts.body),
      emailMessageId: opts.emailMessageId ? noNul(opts.emailMessageId) : null,
    }).returning({ id: messages.id });
    await tx
      .update(tickets)
      .set({ status: "open", closedAt: null, updatedAt: new Date() })
      .where(and(eq(tickets.orgId, opts.orgId), eq(tickets.id, opts.ticketId)));
    return message.id;
  });
}

export async function updateTicket(
  orgId: string,
  ticketId: string,
  patch: { status?: TicketStatus; assigneeId?: string | null; tags?: string[] },
) {
  const set: Partial<typeof tickets.$inferInsert> = { updatedAt: new Date() };
  if (patch.status) {
    set.status = patch.status;
    set.closedAt = patch.status === "closed" ? new Date() : null;
  }
  if (patch.assigneeId !== undefined) set.assigneeId = patch.assigneeId;
  if (patch.tags) {
    set.tags = normalizeTags(patch.tags);
    const [current] = await db.select({ assigneeId: tickets.assigneeId }).from(tickets).where(and(eq(tickets.orgId, orgId), eq(tickets.id, ticketId)));
    if (current && !current.assigneeId && patch.assigneeId === undefined) {
      const assignee = await ruleAssignee(db, orgId, set.tags);
      if (assignee) set.assigneeId = assignee;
    }
  }
  await db.update(tickets).set(set).where(and(eq(tickets.orgId, orgId), eq(tickets.id, ticketId)));
}
