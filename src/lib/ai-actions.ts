import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AiActionInput } from "@/db/schema";
import { postWebhook, sign } from "@/lib/alerts";
import { deliverReply } from "@/lib/email";
import { unseal } from "@/lib/import/crypto";
import { shopifyForCustomer } from "@/lib/integrations";
import { accessToken, type ShopifyCreds } from "@/lib/integrations/shopify";
import { checkShopifyCancel, checkStripeCancel, checkStripeRefund, shopifyRecords, stripeRecords, type Checked } from "@/lib/integrations/writes";
import { hit, LIMITS } from "@/lib/rate-limit";
import { SITE } from "@/lib/site";

// AI actions: things the AI may do for a customer while it answers, set up
// by an admin on /app/actions.
//
// - Built in, on the team's connected accounts: refund a Stripe payment,
//   cancel a Stripe subscription at the end of its period, cancel a Shopify
//   order that hasn't shipped. Each checks the payment, subscription or order
//   belongs to the ticket's customer before anything happens.
// - The team's own endpoint (a webhook): reset a password, change a plan,
//   resend a licence. Flatdesk POSTs the inputs the AI filled in, signed with
//   the action's secret. A "lookup" webhook only reads, and its answer goes
//   back to the AI ("what plan am I on?").
//
// Rules the server enforces, whatever the AI decides:
// - Only for verified senders: email tickets (mail that failed DMARC is never
//   answered). Chat visitors type any email, so they get no actions or records.
// - At most one change per reply, and it runs only if the AI then answers. If
//   it fails, the reply isn't sent and the ticket goes to the team.
// - Each action has an approval rule. A run that needs approval waits on the
//   ticket with the AI's reply; a person approves (it runs, the reply goes
//   out) or declines (the ticket stays with the team).
// - Test tickets never change anything in Stripe or Shopify. Webhooks are
//   called with "test": true.

const { aiActions, aiActionRuns, integrations, tickets, messages, aiEvents } = schema;

export type ActionRow = typeof aiActions.$inferSelect;
export type ActionKind = ActionRow["kind"];
export type RunRow = typeof aiActionRuns.$inferSelect;

export const MAX_ACTIONS = 20;
export const MAX_INPUTS = 5;
const MAX_LOOKUPS_PER_REPLY = 3;
const RESULT_CHARS = 4000;

type BuiltIn = { integration: "stripe" | "shopify"; name: string; whenToUse: string; describe: string; inputs: AiActionInput[]; scope: string; money: boolean };

export const BUILT_IN: Record<Exclude<ActionKind, "webhook">, BuiltIn> = {
  stripe_refund: {
    integration: "stripe",
    name: "Refund a Stripe payment",
    whenToUse: "When a customer asks for a refund of a payment from the last 30 days.",
    describe: "Refunds all or part of one of the customer's Stripe payments, to the card they paid with.",
    inputs: [
      { name: "payment_id", description: "The payment's id from the customer's records, like ch_..." },
      { name: "amount", description: "How much to refund in the payment's currency, like 12.50. An empty string refunds what's left of the payment." },
    ],
    scope: "Write access to Refunds",
    money: true,
  },
  stripe_cancel: {
    integration: "stripe",
    name: "Cancel a Stripe subscription",
    whenToUse: "When a customer clearly asks to cancel their subscription.",
    describe: "Sets one of the customer's Stripe subscriptions to cancel at the end of the period they've paid for. They keep access until then and aren't charged again.",
    inputs: [{ name: "subscription_id", description: "The subscription's id from the customer's records, like sub_..." }],
    scope: "Write access to Subscriptions",
    money: false,
  },
  shopify_cancel: {
    integration: "shopify",
    name: "Cancel a Shopify order",
    whenToUse: "When a customer asks to cancel an order that hasn't shipped yet.",
    describe: "Cancels one of the customer's Shopify orders that hasn't shipped, refunds it to the original payment and restocks the items.",
    inputs: [{ name: "order_id", description: "The order's id from the customer's records, like gid://shopify/Order/123" }],
    scope: "the write_orders scope",
    money: true,
  },
};

export class ActionError extends Error {}

export async function listActions(orgId: string): Promise<ActionRow[]> {
  return db.select().from(aiActions).where(eq(aiActions.orgId, orgId)).orderBy(asc(aiActions.createdAt));
}

// Whether a run of this action, for this amount, waits for a person.
export function needsApproval(a: Pick<ActionRow, "approval" | "limitCents" | "lookup">, amountCents: number | null): boolean {
  if (a.lookup) return false;
  if (a.approval === "never") return false;
  if (a.approval === "always") return true;
  // over_limit: an action with no amount, or no limit set, waits.
  return amountCents === null || a.limitCents === null || amountCents > a.limitCents;
}

// Tool names the model sees: the built-in kind, or webhook_<n>.
function toolName(a: ActionRow, i: number) {
  return a.kind === "webhook" ? `webhook_${i + 1}` : a.kind;
}

export function toolFor(a: ActionRow, i: number): Anthropic.Beta.BetaTool {
  const b = a.kind === "webhook" ? null : BUILT_IN[a.kind];
  const inputs = b ? b.inputs : a.inputs;
  const what = b ? b.describe : a.lookup ? "Looks something up in the team's own system. The answer comes back to you." : "Does this in the team's own system.";
  const when = a.whenToUse.trim();
  return {
    name: toolName(a, i),
    description: `${a.name}. ${what}${when ? `\nThe team says when to use it: ${when}` : ""}`.slice(0, 2000),
    input_schema: {
      type: "object",
      properties: Object.fromEntries(inputs.map((x) => [x.name, { type: "string", description: x.description }])),
      required: inputs.map((x) => x.name),
      additionalProperties: false,
    },
    strict: true,
  };
}

// Everything the AI gets for one ticket: tools for the team's actions and the
// customer's records, plus what it asked for while answering.
export type ActionContext = {
  tools: Anthropic.Beta.BetaTool[];
  records: string; // "" when there are none
  use(name: string, input: unknown): Promise<{ content: string; isError: boolean }>;
  // The one change the AI asked for, checked but not yet run.
  pending: Pending | null;
};

export type Pending = {
  action: ActionRow;
  inputs: Record<string, string>;
  summary: string;
  amountCents: number | null;
  approval: boolean;
};

type TicketInfo = { id: string; number: number; subject: string; channel: string; test: boolean };
type CustomerInfo = { email: string; name: string | null };

async function creds(orgId: string, kind: "stripe" | "shopify") {
  const [row] = await db.select().from(integrations).where(and(eq(integrations.orgId, orgId), eq(integrations.kind, kind)));
  return row ? unseal(row.credentials) : null;
}

// Checks a change against the customer's real data, and says what it would do.
export async function checkAction(orgId: string, a: ActionRow, inputs: Record<string, string>, customer: CustomerInfo, fetcher: typeof fetch = fetch): Promise<Checked> {
  try {
    if (a.kind === "stripe_refund" || a.kind === "stripe_cancel") {
      const c = await creds(orgId, "stripe");
      if (!c) return { error: "Stripe isn't connected." };
      return a.kind === "stripe_refund" ? checkStripeRefund(c.key, customer.email, inputs, fetcher) : checkStripeCancel(c.key, customer.email, inputs, fetcher);
    }
    if (a.kind === "shopify_cancel") {
      const c = (await creds(orgId, "shopify")) as ShopifyCreds | null;
      if (!c) return { error: "Shopify isn't connected." };
      return checkShopifyCancel(c, () => accessToken(c, fetcher), customer.email, inputs, fetcher);
    }
    if (!a.url) return { error: "This action has no address." };
    const filled = a.inputs.map((x) => `${x.name}: ${inputs[x.name] || "(empty)"}`).join(", ");
    return { summary: `${a.name}${filled ? ` (${filled})` : ""}`, amountCents: null, run: async () => "" };
  } catch (err) {
    return { error: err instanceof Error && err.message ? err.message : "The check failed." };
  }
}

// Runs a checked change. Built-in actions on a test ticket only pretend.
async function execute(
  orgId: string,
  a: ActionRow,
  checked: Extract<Checked, { summary: string }>,
  inputs: Record<string, string>,
  ticket: TicketInfo,
  customer: CustomerInfo,
  runId: string,
  fetcher?: typeof fetch,
): Promise<string> {
  if (a.kind === "webhook") return callWebhook(a, inputs, ticket, customer, runId, fetcher);
  if (ticket.test) return `Test ticket, so nothing was changed in ${BUILT_IN[a.kind].integration === "stripe" ? "Stripe" : "Shopify"}.`;
  return checked.run(runId);
}

// The JSON the team's endpoint receives. Documented on /app/actions.
export function webhookBody(a: Pick<ActionRow, "name" | "id">, inputs: Record<string, string>, ticket: TicketInfo, customer: CustomerInfo, runId: string) {
  return JSON.stringify({
    event: "ai_action",
    action: { id: a.id, name: a.name },
    inputs,
    customer: { email: customer.email, name: customer.name },
    ticket: { number: ticket.number, subject: ticket.subject, url: `${SITE.url}/app/tickets/${ticket.number}`, test: ticket.test },
    run_id: runId,
    sent_at: new Date().toISOString(),
  });
}

// What the endpoint answered, for the AI and the ticket: a "message" field
// if it sent JSON with one, else the text itself.
export function answerText(raw: string): string {
  const text = raw.trim();
  try {
    const j = JSON.parse(text) as unknown;
    if (j && typeof j === "object" && typeof (j as { message?: unknown }).message === "string") return ((j as { message: string }).message || "Done.").slice(0, RESULT_CHARS);
  } catch {
    // not JSON
  }
  return (text || "Done.").slice(0, RESULT_CHARS);
}

async function callWebhook(a: ActionRow, inputs: Record<string, string>, ticket: TicketInfo, customer: CustomerInfo, runId: string, fetcher?: typeof fetch): Promise<string> {
  if (!a.url) throw new ActionError("This action has no address.");
  const body = webhookBody(a, inputs, ticket, customer, runId);
  const headers = { "content-type": "application/json", "user-agent": "Flatdesk-Actions/1", "x-flatdesk-event": "ai_action", "x-flatdesk-signature": sign(a.secret, body) };
  // Tests pass a fake fetch; real calls go through the public-address check.
  if (fetcher) {
    const res = await fetcher(a.url, { method: "POST", headers, body });
    const text = await res.text();
    if (!res.ok) throw new ActionError(`Your endpoint answered ${res.status}${text.trim() ? `: ${text.trim().slice(0, 200)}` : "."}`);
    return answerText(text);
  }
  let res: Awaited<ReturnType<typeof postWebhook>>;
  try {
    res = await postWebhook(a.url, body, headers, 8000, 10_000);
  } catch (err) {
    throw new ActionError(err instanceof Error && err.name === "TimeoutError" ? "Your endpoint didn't answer within 10 seconds." : `Your endpoint couldn't be reached${err instanceof Error && err.message ? ` (${err.message})` : ""}.`);
  }
  if (res.status < 200 || res.status >= 300) throw new ActionError(`Your endpoint answered ${res.status}${res.body.trim() ? `: ${res.body.trim().slice(0, 200)}` : "."}`);
  return answerText(res.body);
}

const failure = (err: unknown) => (err instanceof Error && err.message ? err.message.slice(0, 500) : "It failed.");

// Only plain strings, trimmed and bounded, under the names the action declares.
function cleanInputs(names: string[], raw: unknown): Record<string, string> {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(names.map((n) => [n, typeof obj[n] === "string" ? (obj[n] as string).replace(/\0/g, "").trim().slice(0, 500) : ""]));
}

// The customer's records from connected Shopify and Stripe, for the AI.
async function customerRecords(orgId: string, email: string, shopify: boolean, stripe: boolean, fetcher?: typeof fetch): Promise<string> {
  const parts: string[] = [];
  if (shopify) {
    const r = await shopifyForCustomer(orgId, email, fetcher);
    if (r.state === "ok") parts.push(`Shopify orders:\n${shopifyRecords(r.data)}`);
  }
  if (stripe) {
    const c = await creds(orgId, "stripe").catch(() => null);
    const text = c ? await stripeRecords(c.key, email, fetcher).catch(() => undefined) : undefined;
    if (text !== undefined) parts.push(`Stripe:\n${text ?? "No Stripe customer with this email."}`);
  }
  if (!parts.length) return "";
  return `<customer_records>
The customer's records in the team's own systems, found by their email, which is verified. Use them to answer questions about their orders, payments and subscriptions, and for the ids your actions need.
${parts.join("\n\n")}
</customer_records>`;
}

// What the AI gets for this ticket, or null when there's nothing (chat
// tickets, or a team with no actions and records off).
export async function actionContext(
  org: { id: string; aiReadsRecords: boolean },
  ticket: TicketInfo,
  customer: CustomerInfo,
  fetcher?: typeof fetch,
): Promise<ActionContext | null> {
  if (ticket.channel !== "email") return null;
  const [actions, connected] = await Promise.all([
    db.select().from(aiActions).where(and(eq(aiActions.orgId, org.id), eq(aiActions.enabled, true))).orderBy(asc(aiActions.createdAt)),
    db.select({ kind: integrations.kind }).from(integrations).where(eq(integrations.orgId, org.id)),
  ]);
  const has = new Set(connected.map((c) => c.kind));
  const usable = actions.filter((a) => (a.kind === "webhook" ? Boolean(a.url) : has.has(BUILT_IN[a.kind].integration))).slice(0, MAX_ACTIONS);
  const wantShopify = has.has("shopify") && (org.aiReadsRecords || usable.some((a) => a.kind === "shopify_cancel"));
  const wantStripe = has.has("stripe") && (org.aiReadsRecords || usable.some((a) => a.kind.startsWith("stripe_")));
  const records = wantShopify || wantStripe ? await customerRecords(org.id, customer.email, wantShopify, wantStripe, fetcher) : "";
  if (!usable.length && !records) return null;

  const byTool = new Map(usable.map((a, i) => [toolName(a, i), a]));
  let lookups = 0;
  const ctx: ActionContext = {
    tools: usable.map(toolFor),
    records,
    pending: null,
    async use(name, raw) {
      const a = byTool.get(name);
      if (!a) return { content: "There's no such action.", isError: true };
      const inputs = cleanInputs((a.kind === "webhook" ? a.inputs : BUILT_IN[a.kind].inputs).map((x) => x.name), raw);

      if (a.lookup) {
        lookups += 1;
        if (lookups > MAX_LOOKUPS_PER_REPLY) return { content: "That's enough lookups for one reply. Answer with what you have, or hand off.", isError: true };
        if (!(await hit(LIMITS.aiLookups(org.id))).ok) return { content: "Lookups are busy right now. Hand off.", isError: true };
        const runId = randomUUID();
        const checked = await checkAction(org.id, a, inputs, customer, fetcher);
        if ("error" in checked) return { content: checked.error, isError: true };
        try {
          const out = await execute(org.id, a, checked, inputs, ticket, customer, runId, fetcher);
          await saveRun(org.id, ticket.id, a, inputs, { summary: checked.summary, amountCents: null }, "done", { id: runId, result: out });
          return { content: out, isError: false };
        } catch (err) {
          await saveRun(org.id, ticket.id, a, inputs, { summary: checked.summary, amountCents: null }, "failed", { id: runId, result: failure(err) });
          return { content: `The lookup failed: ${failure(err)} Hand off.`, isError: true };
        }
      }

      if (ctx.pending) return { content: "You can take only one action per reply. Hand off if the customer needs more than one.", isError: true };
      const checked = await checkAction(org.id, a, inputs, customer, fetcher);
      if ("error" in checked) return { content: `${checked.error} Hand off unless you can fix it.`, isError: true };
      // Past the daily number of runs without a person, everything waits.
      const approval = needsApproval(a, checked.amountCents) || !(await hit(LIMITS.aiActionsAuto(org.id))).ok;
      ctx.pending = { action: a, inputs, summary: checked.summary, amountCents: checked.amountCents, approval };
      return {
        content: approval
          ? `Checked: ${checked.summary}. A person on the team approves this before it happens. Write your reply as if it's done: it's sent only once they approve.`
          : `Checked: ${checked.summary}. It happens when you send your answer. Write your reply as if it's done. If it fails, your reply isn't sent.`,
        isError: false,
      };
    },
  };
  return ctx;
}

async function saveRun(
  orgId: string,
  ticketId: string,
  a: ActionRow,
  inputs: Record<string, string>,
  what: { summary: string; amountCents: number | null },
  status: RunRow["status"],
  extra: Partial<typeof aiActionRuns.$inferInsert> = {},
) {
  const [row] = await db
    .insert(aiActionRuns)
    .values({ orgId, ticketId, actionId: a.id, kind: a.kind, actionName: a.name, inputs, summary: what.summary, amountCents: what.amountCents, status, ...extra })
    .returning();
  return row;
}

// Runs the AI's change now, before its reply goes out. Re-checked first, in
// case something changed while the model was thinking.
export async function runPending(orgId: string, ticket: TicketInfo, customer: CustomerInfo, p: Pending, aiEventId: string | null, fetcher?: typeof fetch): Promise<{ ok: true; result: string } | { ok: false; error: string }> {
  const runId = randomUUID();
  const checked = await checkAction(orgId, p.action, p.inputs, customer, fetcher);
  const what = { summary: p.summary, amountCents: p.amountCents };
  if ("error" in checked) {
    await saveRun(orgId, ticket.id, p.action, p.inputs, what, "failed", { id: runId, result: checked.error, aiEventId });
    return { ok: false, error: checked.error };
  }
  try {
    const result = await execute(orgId, p.action, checked, p.inputs, ticket, customer, runId, fetcher);
    await saveRun(orgId, ticket.id, p.action, p.inputs, what, "done", { id: runId, result, aiEventId });
    return { ok: true, result };
  } catch (err) {
    await saveRun(orgId, ticket.id, p.action, p.inputs, what, "failed", { id: runId, result: failure(err), aiEventId });
    return { ok: false, error: failure(err) };
  }
}

// Holds the AI's change and its reply until a person decides.
export async function holdPending(orgId: string, ticketId: string, p: Pending, reply: string, aiEventId: string | null, followUp: boolean) {
  return saveRun(orgId, ticketId, p.action, p.inputs, { summary: p.summary, amountCents: p.amountCents }, "waiting", { reply, aiEventId, followUp });
}

export async function waitingRun(orgId: string, ticketId: string): Promise<RunRow | null> {
  const [row] = await db
    .select()
    .from(aiActionRuns)
    .where(and(eq(aiActionRuns.orgId, orgId), eq(aiActionRuns.ticketId, ticketId), eq(aiActionRuns.status, "waiting")))
    .orderBy(desc(aiActionRuns.createdAt))
    .limit(1);
  return row ?? null;
}

export async function ticketRuns(orgId: string, ticketId: string): Promise<RunRow[]> {
  return db.select().from(aiActionRuns).where(and(eq(aiActionRuns.orgId, orgId), eq(aiActionRuns.ticketId, ticketId))).orderBy(asc(aiActionRuns.createdAt));
}

const note = (orgId: string, ticketId: string, body: string, at?: Date) =>
  db.insert(messages).values({ orgId, ticketId, authorType: "system", body, internal: true, ...(at ? { createdAt: at } : {}) });

// A person approves or declines a waiting run. Approving runs it (checked
// again first) and sends the AI's held reply, unless someone on the team has
// replied since. Declining leaves the ticket with the team.
export async function decideRun(
  orgId: string,
  runId: string,
  actor: { userId: string; name: string },
  approve: boolean,
  fetcher?: typeof fetch,
): Promise<{ ok: true; message: string } | { error: string }> {
  const { aiFooter, handBackToTeam, monthKey } = await import("@/lib/ai");
  const [run] = await db
    .update(aiActionRuns)
    .set({ status: approve ? "done" : "declined", decidedBy: actor.userId, decidedByName: actor.name, decidedAt: new Date() })
    .where(and(eq(aiActionRuns.orgId, orgId), eq(aiActionRuns.id, runId), eq(aiActionRuns.status, "waiting")))
    .returning();
  if (!run) return { error: "Someone already decided this one." };
  const ticket = await db.query.tickets.findFirst({ where: and(eq(tickets.orgId, orgId), eq(tickets.id, run.ticketId)) });
  if (!ticket) return { error: "That ticket doesn't exist." };

  if (!approve) {
    await note(orgId, ticket.id, `${actor.name} declined the AI's request to ${lower(run.summary)}. The AI's reply wasn't sent, and the ticket is with the team.`);
    if (run.followUp) await handBackToTeam(orgId, ticket.id, "The AI's request was declined, so this ticket is now with the team.", false);
    return { ok: true, message: "Declined. Nothing was changed and the ticket stays with the team." };
  }

  const [action] = run.actionId ? await db.select().from(aiActions).where(and(eq(aiActions.orgId, orgId), eq(aiActions.id, run.actionId))) : [];
  const customer = await db.query.customers.findFirst({ where: eq(schema.customers.id, ticket.customerId) });
  const fail = async (error: string) => {
    await db.update(aiActionRuns).set({ status: "failed", result: error }).where(eq(aiActionRuns.id, run.id));
    await note(orgId, ticket.id, `${actor.name} approved the AI's request to ${lower(run.summary)}, but it failed: ${error} The AI's reply wasn't sent.`);
    return { error: `It failed: ${error}` };
  };
  if (!action || !customer) return fail("The action was deleted.");
  if (!action.enabled) return fail("The action is turned off.");
  const info = { id: ticket.id, number: ticket.number, subject: ticket.subject, channel: ticket.channel, test: ticket.test };
  const checked = await checkAction(orgId, action, run.inputs, customer, fetcher);
  if ("error" in checked) return fail(checked.error);
  let result: string;
  try {
    result = await execute(orgId, action, checked, run.inputs, info, customer, run.id, fetcher);
  } catch (err) {
    return fail(failure(err));
  }
  await db.update(aiActionRuns).set({ result }).where(eq(aiActionRuns.id, run.id));

  // Someone on the team replied while it waited: their reply stands.
  const [replied] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.ticketId, ticket.id), eq(messages.authorType, "agent"), eq(messages.internal, false), gt(messages.createdAt, run.createdAt)))
    .limit(1);
  if (replied || !run.reply.trim()) {
    await note(orgId, ticket.id, `${actor.name} approved: ${run.summary}. ${result} The AI's reply wasn't sent because someone on the team already replied.`);
    return { ok: true, message: "Done. The AI's reply wasn't sent, since the team already replied." };
  }
  const now = new Date();
  const [m] = await db.insert(messages).values({ orgId, ticketId: ticket.id, authorType: "ai", body: run.reply + aiFooter, createdAt: now }).returning({ id: messages.id });
  await note(orgId, ticket.id, `${actor.name} approved: ${run.summary}. ${result} The AI's reply was sent.`, new Date(now.getTime() + 1));
  await db
    .update(tickets)
    .set({ status: "pending", resolvedByAi: true, firstResponseAt: ticket.firstResponseAt ?? now, updatedAt: now })
    .where(eq(tickets.id, ticket.id));
  // The AI's answer counts once a person lets it out, like any AI answer,
  // as long as its month isn't over (a past month's counts never change).
  if (run.aiEventId && !run.followUp) {
    await db
      .update(aiEvents)
      .set({ kind: "resolution" })
      .where(and(eq(aiEvents.id, run.aiEventId), eq(aiEvents.kind, "handoff"), eq(aiEvents.month, monthKey())));
  }
  try {
    await deliverReply(orgId, m.id);
  } catch (err) {
    console.error("approved AI reply saved but sending failed", err);
    await note(orgId, ticket.id, "The AI's reply was saved, but the email didn't go out. Resend it from the ticket.");
  }
  return { ok: true, message: "Done, and the AI's reply was sent." };
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// Counts for the actions page: runs in the last 30 days by status.
export async function runCounts(orgId: string) {
  const rows = await db
    .select({ actionId: aiActionRuns.actionId, status: aiActionRuns.status, n: sql<number>`count(*)::int` })
    .from(aiActionRuns)
    .where(and(eq(aiActionRuns.orgId, orgId), sql`${aiActionRuns.createdAt} > now() - interval '30 days'`))
    .groupBy(aiActionRuns.actionId, aiActionRuns.status);
  const out = new Map<string, Partial<Record<RunRow["status"], number>>>();
  for (const r of rows) {
    if (!r.actionId) continue;
    out.set(r.actionId, { ...out.get(r.actionId), [r.status]: Number(r.n) });
  }
  return out;
}

export async function waitingRuns(orgId: string) {
  return db
    .select({ run: aiActionRuns, number: tickets.number, subject: tickets.subject })
    .from(aiActionRuns)
    .innerJoin(tickets, eq(tickets.id, aiActionRuns.ticketId))
    .where(and(eq(aiActionRuns.orgId, orgId), eq(aiActionRuns.status, "waiting")))
    .orderBy(asc(aiActionRuns.createdAt))
    .limit(50);
}
