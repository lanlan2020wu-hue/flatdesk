import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError, patchTicket, postMessage } from "@/lib/api";
import type { ApiCaller } from "@/lib/api-keys";
import { access } from "@/lib/billing";
import { isUuid } from "@/lib/ids";
import { slackConnection } from "@/lib/integrations";
import { readReply, REPLY_CALLBACK, replyModal, slackApi, slackUserEmail, withNote } from "./slack";

// What the buttons on a Slack alert do, and the reply form behind Reply.
// Everything runs as the Flatdesk agent whose email matches the Slack user's.

type Payload = {
  type?: string;
  team?: { id?: string };
  user?: { id?: string };
  trigger_id?: string;
  response_url?: string;
  actions?: { action_id?: string; value?: string }[];
  message?: { blocks?: unknown[] };
  view?: { callback_id?: string; private_metadata?: string; state?: { values?: Record<string, Record<string, { value?: string; selected_option?: { value: string } }>> } };
};

export type Outcome = { response?: unknown; later?: () => Promise<void> };

const { agents, tickets, customers, messages } = schema;

type Conn = NonNullable<Awaited<ReturnType<typeof slackConnection>>>;
type Agent = typeof agents.$inferSelect;

// The person clicking, as someone on the Flatdesk team, or why they can't act.
async function agentFor(conn: Conn, slackUserId: string, fetcher: typeof fetch): Promise<Agent | string> {
  const email = await slackUserEmail(conn.token, slackUserId, fetcher);
  if (!email) return "Flatdesk couldn't read your Slack email address.";
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.orgId, conn.orgId), sql`lower(${agents.email}) = ${email}`, sql`${agents.removedAt} is null`));
  if (!agent) return `Nobody on the Flatdesk team has your Slack email (${email}). Sign in to Flatdesk with that address, or reply from Flatdesk.`;
  if (agent.viewer) return "You have a viewer seat in Flatdesk, so you can't reply or take tickets.";
  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, conn.orgId) });
  if (!org || access(org).state === "locked") return "Your Flatdesk trial has ended. An admin can add a card in Settings.";
  return agent;
}

const callerFor = (conn: Conn, agent: Agent): ApiCaller => ({ orgId: conn.orgId, keyId: "slack", createdBy: agent.userId, locked: false });

async function respond(responseUrl: string | null | undefined, body: Record<string, unknown>, fetcher: typeof fetch) {
  if (!responseUrl || !/^https:\/\/hooks\.slack\.com\//.test(responseUrl)) return;
  await fetcher(responseUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) }).catch((err) =>
    console.error("slack response failed", err),
  );
}
const tellOnly = (responseUrl: string | null | undefined, text: string, fetcher: typeof fetch) => respond(responseUrl, { response_type: "ephemeral", replace_original: false, text }, fetcher);

async function ticketIn(orgId: string, id: string | undefined) {
  if (!id || !isUuid(id)) return null;
  const [row] = await db
    .select({ ticket: tickets, email: customers.email, name: customers.name })
    .from(tickets)
    .innerJoin(customers, eq(customers.id, tickets.customerId))
    .where(and(eq(tickets.orgId, orgId), eq(tickets.id, id)));
  return row ?? null;
}

export async function handleSlackInteraction(raw: unknown, fetcher: typeof fetch = fetch): Promise<Outcome> {
  const p = (raw ?? {}) as Payload;
  const conn = p.team?.id ? await slackConnection(p.team.id) : null;
  if (!conn || !p.user?.id) return {};

  if (p.type === "block_actions") {
    const action = p.actions?.[0];
    if (!action || (action.action_id !== "reply" && action.action_id !== "assign_me")) return {}; // Open is a link
    const agent = await agentFor(conn, p.user.id, fetcher);
    if (typeof agent === "string") return { later: () => tellOnly(p.response_url, agent, fetcher) };
    const found = await ticketIn(conn.orgId, action.value);
    if (!found) return { later: () => tellOnly(p.response_url, "That ticket isn't in Flatdesk anymore.", fetcher) };

    if (action.action_id === "reply") {
      const [last] = await db
        .select({ body: messages.body })
        .from(messages)
        .where(and(eq(messages.ticketId, found.ticket.id), eq(messages.internal, false), eq(messages.authorType, "customer")))
        .orderBy(desc(messages.createdAt))
        .limit(1);
      const modal = replyModal(
        { id: found.ticket.id, number: found.ticket.number, subject: found.ticket.subject, customer: found.name ? `${found.name} (${found.email})` : found.email, lastMessage: last?.body ?? null },
        p.response_url ?? null,
      );
      try {
        await slackApi(conn.token, "views.open", { trigger_id: p.trigger_id, view: modal }, fetcher);
      } catch (err) {
        console.error("slack views.open failed", err);
        return { later: () => tellOnly(p.response_url, "Slack couldn't open the reply form. Try again, or reply in Flatdesk.", fetcher) };
      }
      return {};
    }

    // Assign to me.
    return {
      later: async () => {
        try {
          await patchTicket(callerFor(conn, agent), String(found.ticket.number), { assignee_email: agent.email });
          await respond(p.response_url, { replace_original: true, blocks: withNote(p.message?.blocks, `Assigned to ${agent.name} from Slack.`) }, fetcher);
        } catch (err) {
          await tellOnly(p.response_url, err instanceof ApiError ? err.message : "Flatdesk couldn't assign it. Try again in Flatdesk.", fetcher);
        }
      },
    };
  }

  if (p.type === "view_submission" && p.view?.callback_id === REPLY_CALLBACK) {
    const reply = readReply(p.view.state?.values ?? {});
    if (!reply.body) return { response: { response_action: "errors", errors: { body: "Write a message first." } } };
    let meta: { t?: string; r?: string | null } = {};
    try {
      meta = JSON.parse(p.view.private_metadata ?? "{}");
    } catch {}
    const agent = await agentFor(conn, p.user.id, fetcher);
    if (typeof agent === "string") return { response: { response_action: "errors", errors: { body: agent } } };
    const found = await ticketIn(conn.orgId, meta.t);
    if (!found) return { response: { response_action: "errors", errors: { body: "That ticket isn't in Flatdesk anymore." } } };
    return {
      response: { response_action: "clear" },
      later: async () => {
        try {
          await postMessage(callerFor(conn, agent), String(found.ticket.number), { body: reply.body, internal: reply.internal, status: reply.status, author_email: agent.email });
          const what = reply.internal ? `${agent.name} added a note from Slack` : `${agent.name} replied from Slack`;
          await respond(meta.r, { replace_original: true, blocks: withNote(undefined, `${what}. Ticket is now ${reply.status}.`), text: what }, fetcher);
        } catch (err) {
          await tellOnly(meta.r, err instanceof ApiError ? `Not sent: ${err.message}` : "Not sent: Flatdesk couldn't save it. Your message is below so you can paste it in Flatdesk.\n\n" + reply.body, fetcher);
        }
      },
    };
  }
  return {};
}
