import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { authenticate, type ApiCaller } from "@/lib/api-keys";
import { INPUT, validEmail } from "@/lib/app-input";
import { LOCKED_MESSAGE } from "@/lib/auth";
import { noNul } from "@/lib/ids";
import { hit, LIMITS } from "@/lib/rate-limit";
import { SITE } from "@/lib/site";
import { normalizeTags, type TicketStatus } from "@/lib/tickets";

// Shared pieces of the REST API under /api/v1: auth, errors, and the JSON
// shape of tickets, messages and customers. Documented at /developers.

const { tickets, customers, messages, agents } = schema;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const json = (data: unknown, status = 200, headers?: HeadersInit) => Response.json(data, { status, headers });
const problem = (status: number, error: string, headers?: HeadersInit) => json({ error }, status, headers);

// Runs a handler for a request carrying a valid key, turning ApiErrors (and
// bad JSON) into JSON error responses.
export async function withKey(request: Request, handler: (caller: ApiCaller) => Promise<Response>, opts: { write?: boolean } = {}): Promise<Response> {
  const caller = await authenticate(request);
  if (!caller) return problem(401, "Send a valid API key as Authorization: Bearer fd_... Admins make keys in Flatdesk under Integrations.");
  const limit = await hit(LIMITS.api(caller.keyId));
  if (!limit.ok) return problem(429, "Too many requests for this key. Slow down and try again.", { "retry-after": String(limit.retryAfter) });
  // Like the app, a team whose trial ended without a card can read but not change things.
  if (opts.write && caller.locked) return problem(402, LOCKED_MESSAGE);
  try {
    return await handler(caller);
  } catch (err) {
    if (err instanceof ApiError) return problem(err.status, err.message);
    if (err instanceof SyntaxError) return problem(400, "The request body isn't valid JSON.");
    console.error("api error", err);
    return problem(500, "Something went wrong on our side.");
  }
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 200_000) throw new ApiError(413, "The request body is too large.");
  const body = text ? JSON.parse(text) : {};
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "Send a JSON object.");
  return body as Record<string, unknown>;
}

// Field readers that say which field was wrong.
export function text(body: Record<string, unknown>, key: string, opts: { required?: boolean; max: number }): string | undefined {
  const v = body[key];
  if (v === undefined || v === null || v === "") {
    if (opts.required) throw new ApiError(400, `${key} is required.`);
    return undefined;
  }
  if (typeof v !== "string") throw new ApiError(400, `${key} must be a string.`);
  const s = noNul(v).trim();
  if (opts.required && !s) throw new ApiError(400, `${key} is required.`);
  if (s.length > opts.max) throw new ApiError(400, `${key} can be up to ${opts.max.toLocaleString("en-US")} characters.`);
  return s;
}

export function email(body: Record<string, unknown>, key: string, required = false): string | undefined {
  const v = text(body, key, { required, max: INPUT.email });
  if (v === undefined) return undefined;
  const e = v.toLowerCase();
  if (!validEmail(e)) throw new ApiError(400, `${key} isn't a valid email address.`);
  return e;
}

export function tagArray(body: Record<string, unknown>, key: string): string[] | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || !v.every((t) => typeof t === "string")) throw new ApiError(400, `${key} must be an array of strings.`);
  return normalizeTags(v.map(noNul));
}

export function bool(body: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = body[key];
  if (v === undefined) return fallback;
  if (typeof v !== "boolean") throw new ApiError(400, `${key} must be true or false.`);
  return v;
}

const STATUSES: TicketStatus[] = ["open", "pending", "closed"];
export function status(v: unknown, key = "status"): TicketStatus | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (!STATUSES.includes(v as TicketStatus)) throw new ApiError(400, `${key} must be open, pending or closed.`);
  return v as TicketStatus;
}

// Someone on the team who can reply and be assigned tickets.
export async function agentByEmail(orgId: string, address: string) {
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.orgId, orgId), sql`lower(${agents.email}) = ${address.toLowerCase()}`, isNull(agents.removedAt)));
  if (!agent) throw new ApiError(400, `Nobody on the team has the email ${address}.`);
  if (agent.viewer) throw new ApiError(400, `${address} has a viewer seat, so they can't reply or be assigned tickets.`);
  return agent;
}

export const ticketUrl = (number: number) => `${SITE.url}/app/tickets/${number}`;

type TicketRow = { ticket: typeof tickets.$inferSelect; customer: typeof customers.$inferSelect; assigneeName: string | null; assigneeEmail: string | null };

export function ticketJson({ ticket: t, customer: c, assigneeName, assigneeEmail }: TicketRow) {
  return {
    number: t.number,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    channel: t.channel,
    tags: t.tags,
    cc: t.cc,
    customer: { email: c.email, name: c.name },
    assignee: t.assigneeId ? { name: assigneeName, email: assigneeEmail } : null,
    answered_by_ai: t.resolvedByAi,
    test: t.test,
    url: ticketUrl(t.number),
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString(),
    first_response_at: t.firstResponseAt?.toISOString() ?? null,
    closed_at: t.closedAt?.toISOString() ?? null,
  };
}

const ticketSelect = {
  ticket: tickets,
  customer: customers,
  assigneeName: agents.name,
  assigneeEmail: agents.email,
};

function ticketQuery() {
  return db
    .select(ticketSelect)
    .from(tickets)
    .innerJoin(customers, eq(customers.id, tickets.customerId))
    .leftJoin(agents, and(eq(agents.orgId, tickets.orgId), eq(agents.userId, tickets.assigneeId)))
    .$dynamic();
}

export async function findTicket(orgId: string, rawNumber: string) {
  const number = /^\d{1,10}$/.test(rawNumber) ? Number(rawNumber) : NaN;
  if (!(number >= 1 && number <= 2_147_483_647)) throw new ApiError(404, "There's no ticket with that number.");
  const [row] = await ticketQuery().where(and(eq(tickets.orgId, orgId), eq(tickets.number, number)));
  if (!row) throw new ApiError(404, "There's no ticket with that number.");
  return row;
}

// Newest change first. updated_since makes polling cheap: Zapier and Make
// remember the newest updated_at they've seen and ask for anything after it.
export async function listTicketsJson(orgId: string, params: URLSearchParams) {
  const where = [eq(tickets.orgId, orgId)];
  const s = status(params.get("status") ?? undefined);
  if (s) where.push(eq(tickets.status, s));
  const since = params.get("updated_since");
  if (since) {
    const d = new Date(since);
    if (Number.isNaN(d.getTime())) throw new ApiError(400, "updated_since must be a date and time, like 2026-10-01T09:00:00Z.");
    where.push(gt(tickets.updatedAt, d));
  }
  const customerEmail = params.get("customer_email");
  if (customerEmail) where.push(eq(customers.email, customerEmail.trim().toLowerCase()));
  const tag = params.get("tag");
  if (tag) where.push(sql`${normalizeTags([tag])[0] ?? ""} = any(${tickets.tags})`);
  const rawLimit = Number(params.get("limit") ?? 50);
  const limit = Number.isInteger(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, 100) : 50;
  const rows = await ticketQuery().where(and(...where)).orderBy(desc(tickets.updatedAt), desc(tickets.number)).limit(limit);
  return rows.map(ticketJson);
}

export async function messagesJson(orgId: string, ticketId: string) {
  const rows = await db
    .select({ m: messages, agentName: agents.name })
    .from(messages)
    .leftJoin(agents, and(eq(agents.orgId, messages.orgId), eq(agents.userId, messages.authorId)))
    .where(and(eq(messages.orgId, orgId), eq(messages.ticketId, ticketId)))
    .orderBy(messages.createdAt);
  return rows.map(({ m, agentName }) => ({
    id: m.id,
    author_type: m.authorType,
    author_name: m.authorType === "agent" ? (agentName ?? m.authorName) : m.authorType === "ai" ? "AI" : m.authorName,
    body: m.body,
    internal: m.internal,
    created_at: m.createdAt.toISOString(),
  }));
}

export async function customerJson(orgId: string, address: string) {
  const c = await db.query.customers.findFirst({ where: and(eq(customers.orgId, orgId), eq(customers.email, address)) });
  if (!c) throw new ApiError(404, "There's no customer with that email.");
  const rows = await ticketQuery().where(and(eq(tickets.orgId, orgId), eq(tickets.customerId, c.id))).orderBy(desc(tickets.createdAt)).limit(50);
  return { email: c.email, name: c.name, fields: c.fields, created_at: c.createdAt.toISOString(), tickets: rows.map(ticketJson) };
}

