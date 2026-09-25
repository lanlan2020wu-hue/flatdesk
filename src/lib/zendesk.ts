import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { normalizeTags } from "@/lib/tickets";

// Copies a team's Zendesk tickets, with their public replies and internal
// notes, into Flatdesk. The API token is used for this run only and never
// stored. Imported tickets keep their dates and status, get new Flatdesk
// numbers, and carry externalId "zendesk:<id>", so running the import again
// skips what's already here and picks up where a timed-out run stopped.
// Nothing is emailed and the AI doesn't answer imported tickets.

const { tickets, messages, customers, orgs, agents } = schema;

export type ZendeskCredentials = { subdomain: string; email: string; token: string };
export type ImportResult = { imported: number; skipped: number; messages: number; finished: boolean };

type ZTicket = {
  id: number;
  subject: string | null;
  description: string | null;
  status: string;
  tags: string[];
  requester_id: number | null;
  created_at: string;
  updated_at: string;
  via?: { channel?: string };
};
type ZComment = { id: number; author_id: number; body: string; plain_body?: string; public: boolean; created_at: string };
type ZUser = { id: number; name: string; email: string | null; role: string };

export class ZendeskError extends Error {}

export const validSubdomain = (s: string) => /^[a-z0-9][a-z0-9-]{0,62}$/.test(s);

function baseUrl(subdomain: string) {
  // ZENDESK_API_URL points at a local fake in tests.
  return process.env.ZENDESK_API_URL ?? `https://${subdomain}.zendesk.com`;
}

async function zget<T>(creds: ZendeskCredentials, path: string, deadline: number): Promise<T> {
  const auth = Buffer.from(`${creds.email}/token:${creds.token}`).toString("base64");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${baseUrl(creds.subdomain)}${path}`, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
      redirect: "error",
    });
    if (res.ok) return (await res.json()) as T;
    if (res.status === 429 && attempt < 5) {
      const wait = Math.min(60, Number(res.headers.get("retry-after")) || 10) * 1000;
      if (Date.now() + wait > deadline) throw new TimeUp();
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new ZendeskError("Zendesk didn't accept that email and API token.");
    if (res.status === 404) throw new ZendeskError("Zendesk couldn't find that account. Check the subdomain.");
    throw new ZendeskError(`Zendesk returned an error (${res.status}). Try again in a few minutes.`);
  }
}

class TimeUp extends Error {}

const STATUS: Record<string, "open" | "pending" | "closed"> = {
  new: "open",
  open: "open",
  hold: "open",
  pending: "pending",
  solved: "closed",
  closed: "closed",
};
const CHAT_CHANNELS = new Set(["chat", "native_messaging", "messaging", "web_widget", "mobile_sdk", "sunshine_conversations"]);

async function commentsFor(creds: ZendeskCredentials, ticketId: number, deadline: number) {
  const comments: ZComment[] = [];
  const users = new Map<number, ZUser>();
  let path: string | null = `/api/v2/tickets/${ticketId}/comments.json?include=users&page[size]=100`;
  while (path) {
    const page: { comments: ZComment[]; users?: ZUser[]; meta?: { has_more: boolean }; links?: { next: string | null } } = await zget(
      creds,
      path,
      deadline,
    );
    comments.push(...page.comments);
    for (const u of page.users ?? []) users.set(u.id, u);
    const next = page.meta?.has_more ? page.links?.next : null;
    path = next ? new URL(next).pathname + new URL(next).search : null;
  }
  return { comments, users };
}

async function requesterFor(creds: ZendeskCredentials, id: number, users: Map<number, ZUser>, deadline: number) {
  const known = users.get(id);
  if (known?.email) return known;
  const { user } = await zget<{ user: ZUser }>(creds, `/api/v2/users/${id}.json`, deadline);
  users.set(id, user);
  return user;
}

export async function importFromZendesk(orgId: string, creds: ZendeskCredentials, budgetMs = 240_000): Promise<ImportResult> {
  const deadline = Date.now() + budgetMs;
  const result: ImportResult = { imported: 0, skipped: 0, messages: 0, finished: false };

  const done = new Set(
    (
      await db
        .select({ id: tickets.externalId })
        .from(tickets)
        .where(and(eq(tickets.orgId, orgId), isNotNull(tickets.externalId)))
    ).map((r) => r.id),
  );
  const team = new Map(
    (await db.select({ email: agents.email, userId: agents.userId }).from(agents).where(eq(agents.orgId, orgId))).map((a) => [
      a.email.toLowerCase(),
      a.userId,
    ]),
  );

  let path: string | null = "/api/v2/incremental/tickets/cursor.json?start_time=0&per_page=500";
  try {
    while (path) {
      const page: { tickets: ZTicket[]; after_url: string | null; end_of_stream: boolean } = await zget(creds, path, deadline);
      for (const t of page.tickets) {
        if (Date.now() > deadline) throw new TimeUp();
        const externalId = `zendesk:${t.id}`;
        if (t.status === "deleted" || done.has(externalId)) {
          result.skipped++;
          continue;
        }
        const { comments, users } = await commentsFor(creds, t.id, deadline);
        const requester = t.requester_id ? await requesterFor(creds, t.requester_id, users, deadline) : null;
        const n = await saveTicket(orgId, t, comments, users, requester, team);
        done.add(externalId);
        result.imported++;
        result.messages += n;
      }
      path = page.end_of_stream || !page.after_url ? null : new URL(page.after_url).pathname + new URL(page.after_url).search;
    }
    result.finished = true;
  } catch (err) {
    if (!(err instanceof TimeUp)) throw err;
  }
  return result;
}

async function saveTicket(
  orgId: string,
  t: ZTicket,
  comments: ZComment[],
  users: Map<number, ZUser>,
  requester: ZUser | null,
  team: Map<string, string>,
) {
  const email = (requester?.email || `zendesk-user-${t.requester_id ?? "unknown"}@imported.invalid`).toLowerCase();
  const status = STATUS[t.status] ?? "open";
  const createdAt = new Date(t.created_at);
  const updatedAt = new Date(t.updated_at);

  const rows = comments.map((c) => {
    const author = users.get(c.author_id);
    const isCustomer = c.author_id === t.requester_id || author?.role === "end-user";
    return {
      isCustomer,
      internal: !c.public,
      authorUserId: !isCustomer && author?.email ? (team.get(author.email.toLowerCase()) ?? null) : null,
      authorName: author?.name ?? null,
      body: (c.plain_body ?? c.body ?? "").trim() || "(empty message)",
      createdAt: new Date(c.created_at),
    };
  });
  if (rows.length === 0) rows.push({ isCustomer: true, internal: false, authorUserId: null, authorName: null, body: t.description || "(no message)", createdAt });
  const firstResponse = rows.find((r) => !r.isCustomer && !r.internal)?.createdAt ?? null;

  return db.transaction(async (tx) => {
    const [customer] = await tx
      .insert(customers)
      .values({ orgId, email, name: requester?.name || null, createdAt })
      .onConflictDoUpdate({ target: [customers.orgId, customers.email], set: { email: sql`excluded.email` } })
      .returning({ id: customers.id });
    const [{ number }] = await tx
      .update(orgs)
      .set({ nextTicketNumber: sql`${orgs.nextTicketNumber} + 1` })
      .where(eq(orgs.id, orgId))
      .returning({ number: sql<number>`${orgs.nextTicketNumber} - 1` });
    const [ticket] = await tx
      .insert(tickets)
      .values({
        orgId,
        number,
        subject: t.subject?.trim() || "(no subject)",
        status,
        channel: CHAT_CHANNELS.has(t.via?.channel ?? "") ? "chat" : "email",
        customerId: customer.id,
        tags: normalizeTags([...(t.tags ?? []), "zendesk"]),
        externalId: `zendesk:${t.id}`,
        createdAt,
        updatedAt,
        firstResponseAt: firstResponse,
        closedAt: status === "closed" ? updatedAt : null,
      })
      .returning({ id: tickets.id });
    await tx.insert(messages).values(
      rows.map((r) => ({
        orgId,
        ticketId: ticket.id,
        authorType: r.isCustomer ? ("customer" as const) : ("agent" as const),
        authorId: r.isCustomer ? customer.id : r.authorUserId,
        // Zendesk agents who aren't on this Flatdesk team keep their name on the message.
        body: !r.isCustomer && !r.authorUserId && r.authorName ? `${r.body}\n\n(${r.authorName}, in Zendesk)` : r.body,
        internal: r.internal,
        createdAt: r.createdAt,
      })),
    );
    return rows.length;
  });
}
