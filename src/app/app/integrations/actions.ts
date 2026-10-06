"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { createApiKey, revokeApiKey } from "@/lib/api-keys";
import { requireAdmin, requireEditor, requireOpen } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { connectHubSpot, connectJira, connectShopify, connectStripe, disconnect, escalateToJira } from "@/lib/integrations";
import { logTicketToHubSpot, saveHubSpotSettings } from "@/lib/integrations/hubspot-sync";
import { audit } from "@/lib/security";
import { SITE } from "@/lib/site";
import { addSystemNote } from "@/lib/tickets";
import { hit, type Limit } from "@/lib/rate-limit";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const requireOpenAdmin = async () => requireOpen(await requireAdmin());

// Each check calls the store's API with what the admin pasted, so not too often.
const connectLimit = (orgId: string): Limit[] => [{ key: `integration-connect:${orgId}`, max: 20, windowSec: 3600 }];

export type ConnectState = { error: string | null; done?: string };

export async function connectShopifyAction(_: ConnectState, form: FormData): Promise<ConnectState> {
  const s = await requireOpenAdmin();
  if (!(await hit(connectLimit(s.orgId))).ok) return { error: "That's a lot of tries. Wait an hour and try again." };
  const result = await connectShopify(s.orgId, s.userId, {
    domain: str(form, "domain"),
    clientId: str(form, "clientId"),
    clientSecret: str(form, "clientSecret"),
    token: str(form, "token"),
  });
  if ("error" in result) return { error: result.error };
  await audit(s.orgId, { userId: s.userId, name: s.name }, "integration.connect", `Shopify: ${result.name}`);
  revalidatePath("/app/integrations");
  return { error: null, done: `Connected to ${result.name}.` };
}

export async function connectStripeAction(_: ConnectState, form: FormData): Promise<ConnectState> {
  const s = await requireOpenAdmin();
  if (!(await hit(connectLimit(s.orgId))).ok) return { error: "That's a lot of tries. Wait an hour and try again." };
  const result = await connectStripe(s.orgId, s.userId, str(form, "key"));
  if ("error" in result) return { error: result.error };
  await audit(s.orgId, { userId: s.userId, name: s.name }, "integration.connect", `Stripe: ${result.name}`);
  revalidatePath("/app/integrations");
  return { error: null, done: `Connected to ${result.name}.` };
}

export async function connectHubSpotAction(_: ConnectState, form: FormData): Promise<ConnectState> {
  const s = await requireOpenAdmin();
  if (!(await hit(connectLimit(s.orgId))).ok) return { error: "That's a lot of tries. Wait an hour and try again." };
  const result = await connectHubSpot(s.orgId, s.userId, str(form, "token"));
  if ("error" in result) return { error: result.error };
  await audit(s.orgId, { userId: s.userId, name: s.name }, "integration.connect", `HubSpot: ${result.name}`);
  revalidatePath("/app/integrations");
  return { error: null, done: `Connected to ${result.name}.` };
}

export async function connectJiraAction(_: ConnectState, form: FormData): Promise<ConnectState> {
  const s = await requireOpenAdmin();
  if (!(await hit(connectLimit(s.orgId))).ok) return { error: "That's a lot of tries. Wait an hour and try again." };
  const result = await connectJira(s.orgId, s.userId, {
    site: str(form, "site"),
    email: str(form, "email"),
    token: str(form, "token"),
    project: str(form, "project"),
    issueType: str(form, "issueType"),
  });
  if ("error" in result) return { error: result.error };
  await audit(s.orgId, { userId: s.userId, name: s.name }, "integration.connect", `Jira: ${result.name}`);
  revalidatePath("/app/integrations");
  return { error: null, done: `Connected. New issues go to ${result.name}.` };
}

// "Send to Jira" on a ticket: the issue gets the summary, the agent's note and
// the customer's first message, with a link back to the ticket.
export async function escalateAction(_: ConnectState, form: FormData): Promise<ConnectState> {
  const s = await requireOpen(await requireEditor());
  if (!(await hit([{ key: `jira-escalate:${s.orgId}`, max: 60, windowSec: 3600 }])).ok) return { error: "That's a lot of Jira issues this hour. Try again later." };
  const ticketId = str(form, "ticketId");
  if (!isUuid(ticketId)) return { error: "That ticket doesn't exist." };
  const ticket = await db.query.tickets.findFirst({ where: and(eq(schema.tickets.orgId, s.orgId), eq(schema.tickets.id, ticketId)) });
  if (!ticket) return { error: "That ticket doesn't exist." };
  const summary = str(form, "summary").slice(0, 250) || ticket.subject;
  const note = str(form, "note").slice(0, 10_000);
  const [first] = await db
    .select({ body: schema.messages.body })
    .from(schema.messages)
    .where(and(eq(schema.messages.ticketId, ticket.id), eq(schema.messages.authorType, "customer")))
    .orderBy(asc(schema.messages.createdAt))
    .limit(1);
  const body = [note, first ? `The customer wrote:\n\n${first.body.slice(0, 10_000)}` : ""].filter(Boolean).join("\n\n");
  const result = await escalateToJira(s.orgId, s.userId, ticket, { summary, body, ticketUrl: `${SITE.url}/app/tickets/${ticket.number}` });
  if ("error" in result) return { error: result.error };
  await addSystemNote(s.orgId, ticket.id, `${s.name} sent this ticket to Jira as ${result.key}.`);
  revalidatePath(`/app/tickets/${ticket.number}`);
  return { error: null, done: `Made ${result.key}.` };
}

// HubSpot write-back settings (lib/integrations/hubspot-sync.ts).
export async function saveHubSpotSettingsAction(form: FormData) {
  const s = await requireOpenAdmin();
  const next = { logClosed: form.get("logClosed") === "on", createContacts: form.get("createContacts") === "on" };
  await saveHubSpotSettings(s.orgId, next);
  await audit(s.orgId, { userId: s.userId, name: s.name }, "integration.connect", `HubSpot: ${next.logClosed ? "logging closed tickets" : "not logging tickets"}${next.logClosed && next.createContacts ? ", adding missing contacts" : ""}`);
  revalidatePath("/app/integrations");
}

// "Log to HubSpot" on a ticket, or "Add to HubSpot" when there's no contact yet.
export async function logToHubSpotAction(_: ConnectState, form: FormData): Promise<ConnectState> {
  const s = await requireOpen(await requireEditor());
  if (!(await hit([{ key: `hubspot-log:${s.orgId}`, max: 120, windowSec: 3600 }])).ok) return { error: "That's a lot of HubSpot notes this hour. Try again later." };
  const ticketId = str(form, "ticketId");
  if (!isUuid(ticketId)) return { error: "That ticket doesn't exist." };
  const ticket = await db.query.tickets.findFirst({ where: and(eq(schema.tickets.orgId, s.orgId), eq(schema.tickets.id, ticketId)) });
  if (!ticket) return { error: "That ticket doesn't exist." };
  const result = await logTicketToHubSpot(s.orgId, ticket.id, { create: form.get("create") === "1" });
  if (!result.ok) return { error: result.reason === "no-contact" ? "There's no HubSpot contact with this email." : (result.error ?? "HubSpot couldn't be reached.") };
  await addSystemNote(s.orgId, ticket.id, result.created ? `${s.name} added the customer to HubSpot and logged this ticket on their contact.` : `${s.name} logged this ticket on the customer's HubSpot contact.`);
  revalidatePath(`/app/tickets/${ticket.number}`);
  return { error: null, done: result.created ? "Added to HubSpot, with this ticket on their timeline." : "Logged on their HubSpot timeline." };
}

export async function disconnectAction(form: FormData) {
  const s = await requireAdmin();
  const kind = str(form, "kind");
  if (kind === "shopify" || kind === "stripe" || kind === "hubspot" || kind === "jira") {
    await disconnect(s.orgId, kind);
    await audit(s.orgId, { userId: s.userId, name: s.name }, "integration.disconnect", kind);
  }
  revalidatePath("/app/integrations");
}

export type KeyState = { error: string | null; key?: string };

// The key is returned once, to the admin who made it, and never stored.
export async function createKeyAction(_: KeyState, form: FormData): Promise<KeyState> {
  const s = await requireOpenAdmin();
  const result = await createApiKey(s.orgId, s.userId, str(form, "name"));
  if ("error" in result) return { error: result.error };
  await audit(s.orgId, { userId: s.userId, name: s.name }, "apikey.create", str(form, "name"));
  revalidatePath("/app/integrations");
  return { error: null, key: result.key };
}

export async function revokeKeyAction(form: FormData) {
  const s = await requireAdmin();
  const id = str(form, "id");
  if (isUuid(id)) {
    await revokeApiKey(s.orgId, id);
    await audit(s.orgId, { userId: s.userId, name: s.name }, "apikey.revoke", id);
  }
  revalidatePath("/app/integrations");
}
