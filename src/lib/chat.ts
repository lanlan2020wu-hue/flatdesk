import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { handBackToTeam } from "@/lib/ai";
import { addCustomerMessage, createTicket } from "@/lib/tickets";

// The website chat widget. A visitor starts a conversation with their name,
// email and first message; that creates a chat ticket and returns a token the
// widget keeps in the visitor's browser to read replies and write again.
// Replies from the team (or the AI) also go to the visitor by email, so a
// closed tab doesn't lose the answer.

export const MAX_MESSAGE = 5000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function orgByWidgetKey(key: string) {
  return db.query.orgs.findFirst({ where: eq(schema.orgs.widgetKey, key), columns: { id: true, name: true } });
}

export function validStart(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 120) : "";
  const message = typeof b.message === "string" ? b.message.trim().slice(0, MAX_MESSAGE) : "";
  if (!EMAIL.test(email) || email.length > 254) return { error: "Enter a valid email so we can reply." } as const;
  if (!message) return { error: "Write a message first." } as const;
  return { email, name, message } as const;
}

export async function startConversation(orgId: string, v: { email: string; name: string; message: string }) {
  const token = randomBytes(24).toString("base64url");
  const firstLine = v.message.split("\n")[0].slice(0, 80);
  const ticket = await createTicket({
    orgId,
    channel: "chat",
    customerEmail: v.email,
    customerName: v.name || null,
    subject: firstLine.length < v.message.length ? `${firstLine}…` : firstLine,
    body: v.message,
    authorType: "customer",
  });
  await db.update(schema.tickets).set({ visitorToken: token }).where(eq(schema.tickets.id, ticket.id));
  return { ticket, token };
}

export async function ticketForVisitor(orgId: string, number: number, token: string) {
  if (!Number.isInteger(number) || !token) return null;
  const ticket = await db.query.tickets.findFirst({ where: and(eq(schema.tickets.orgId, orgId), eq(schema.tickets.number, number)) });
  if (!ticket?.visitorToken) return null;
  const a = Buffer.from(ticket.visitorToken);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b) ? ticket : null;
}

// What the visitor sees: never internal notes or system messages.
export async function visitorThread(ticketId: string) {
  const rows = await db
    .select({
      id: schema.messages.id,
      authorType: schema.messages.authorType,
      body: schema.messages.body,
      createdAt: schema.messages.createdAt,
      agentName: schema.agents.name,
    })
    .from(schema.messages)
    .leftJoin(schema.agents, and(eq(schema.agents.orgId, schema.messages.orgId), eq(schema.agents.userId, schema.messages.authorId)))
    .where(and(eq(schema.messages.ticketId, ticketId), eq(schema.messages.internal, false)))
    .orderBy(asc(schema.messages.createdAt));
  return rows
    .filter((m) => m.authorType !== "system")
    .map((m) => ({
      id: m.id,
      from: m.authorType === "customer" ? "you" : m.authorType === "ai" ? "AI assistant" : (m.agentName?.split(" ")[0] ?? "Support"),
      mine: m.authorType === "customer",
      body: m.body,
      at: m.createdAt.toISOString(),
    }));
}

export async function visitorReply(orgId: string, ticket: { id: string; customerId: string }, message: string) {
  await addCustomerMessage({ orgId, ticketId: ticket.id, customerId: ticket.customerId, body: message.slice(0, MAX_MESSAGE) });
  await handBackToTeam(orgId, ticket.id);
}
