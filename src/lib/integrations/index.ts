import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { seal, unseal } from "@/lib/import/crypto";
import { ShopifyError, shopDomain, shopifyOrders, verifyShopify, type ShopifyCreds, type ShopifyOrder } from "./shopify";
import { checkStripeKey, StripeLookupError, stripeCustomer, verifyStripe, type StripeCustomerView } from "./stripe";
import { checkHubSpotToken, HubSpotError, hubspotContact, verifyHubSpot, type HubSpotContact } from "./hubspot";
import type { SlackInstall } from "./slack";
import { createJiraIssue, JiraError, jiraIssues, jiraSite, projectKey, verifyJira, type JiraCreds, type JiraIssue } from "./jira";

// Connected stores and accounts whose data shows beside a ticket. One of each
// kind per team. Credentials are sealed with the same key as import
// credentials (IMPORT_SECRET) and only opened on the server.

const { integrations } = schema;
export type IntegrationKind = (typeof schema.integrationKind.enumValues)[number];
export type Integration = typeof integrations.$inferSelect;

export async function listIntegrations(orgId: string): Promise<Partial<Record<IntegrationKind, Integration>>> {
  const rows = await db.select().from(integrations).where(eq(integrations.orgId, orgId));
  return Object.fromEntries(rows.map((r) => [r.kind, r]));
}

async function save(orgId: string, kind: IntegrationKind, account: string, creds: Record<string, string>, userId: string, settings?: schema.IntegrationSettings) {
  const values = { account, credentials: seal(creds), connectedBy: userId, lastError: null, lastErrorAt: null, ...(settings ? { settings } : {}) };
  await db
    .insert(integrations)
    .values({ orgId, kind, ...values })
    .onConflictDoUpdate({ target: [integrations.orgId, integrations.kind], set: { ...values, createdAt: new Date() } });
}

// The Slack app (lib/integrations/slack.ts). Alerts go to the channel picked
// while installing it, through the app's own webhook, so they carry buttons.
export async function connectSlack(orgId: string, userId: string, install: SlackInstall) {
  // One Flatdesk team per Slack workspace, so a click in Slack finds one team.
  const [other] = await db
    .select({ orgId: integrations.orgId })
    .from(integrations)
    .where(and(eq(integrations.kind, "slack"), sql`${integrations.settings} ->> 'slackTeamId' = ${install.teamId}`, ne(integrations.orgId, orgId)));
  if (other) return { error: `${install.teamName} is already connected to another Flatdesk team.` };
  await save(orgId, "slack", `${install.teamName} · ${install.channel}`, { token: install.token, webhookUrl: install.webhookUrl, channelId: install.channelId }, userId, { slackTeamId: install.teamId, slackChannel: install.channel });
  await db.update(schema.orgs).set({ alertWebhookUrl: install.webhookUrl, alertLastError: null }).where(eq(schema.orgs.id, orgId));
  return { ok: true as const, error: undefined };
}

// The team and its Slack token for a request Slack sent from this workspace.
export async function slackConnection(teamId: string) {
  const [row] = await db.select().from(integrations).where(and(eq(integrations.kind, "slack"), sql`${integrations.settings} ->> 'slackTeamId' = ${teamId}`));
  if (!row) return null;
  return { orgId: row.orgId, ...(unseal(row.credentials) as { token: string; webhookUrl: string; channelId: string }) };
}

export async function disconnect(orgId: string, kind: IntegrationKind) {
  if (kind === "slack") {
    // Alerts stop too, since they went through the app's webhook.
    const [row] = await db.select().from(integrations).where(and(eq(integrations.orgId, orgId), eq(integrations.kind, "slack")));
    const hook = row ? (unseal(row.credentials) as { webhookUrl?: string }).webhookUrl : undefined;
    if (hook) await db.update(schema.orgs).set({ alertWebhookUrl: null }).where(and(eq(schema.orgs.id, orgId), eq(schema.orgs.alertWebhookUrl, hook)));
  }
  await db.delete(integrations).where(and(eq(integrations.orgId, orgId), eq(integrations.kind, kind)));
}

const failure = (err: unknown) =>
  err instanceof ShopifyError || err instanceof StripeLookupError || err instanceof HubSpotError || err instanceof JiraError
    ? err.message
    : err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")
      ? "It didn't answer in time. Try again."
      : "It couldn't be reached. Try again.";

export async function connectShopify(
  orgId: string,
  userId: string,
  input: { domain: string; clientId: string; clientSecret: string; token: string },
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true; name: string } | { error: string }> {
  const domain = shopDomain(input.domain);
  if (!domain) return { error: "Enter your store's address, like acme.myshopify.com." };
  const token = input.token.trim();
  const clientId = input.clientId.trim();
  const clientSecret = input.clientSecret.trim();
  if (!token && !(clientId && clientSecret)) return { error: "Paste the app's client ID and secret, or an Admin API access token from an older custom app." };
  const creds: ShopifyCreds = token ? { domain, token } : { domain, clientId, clientSecret };
  try {
    const name = await verifyShopify(creds, fetcher);
    await save(orgId, "shopify", domain, token ? { domain, token } : { domain, clientId, clientSecret }, userId);
    return { ok: true, name };
  } catch (err) {
    return { error: `Shopify: ${failure(err)}` };
  }
}

export async function connectStripe(orgId: string, userId: string, raw: string, fetcher: typeof fetch = fetch): Promise<{ ok: true; name: string } | { error: string }> {
  const checked = checkStripeKey(raw);
  if ("error" in checked) return checked;
  try {
    const name = await verifyStripe(checked.key, fetcher);
    await save(orgId, "stripe", name, { key: checked.key }, userId);
    return { ok: true, name };
  } catch (err) {
    return { error: `Stripe: ${failure(err)}` };
  }
}

export async function connectHubSpot(orgId: string, userId: string, raw: string, fetcher: typeof fetch = fetch): Promise<{ ok: true; name: string } | { error: string }> {
  const checked = checkHubSpotToken(raw);
  if ("error" in checked) return checked;
  try {
    const account = await verifyHubSpot(checked.token, fetcher);
    await save(orgId, "hubspot", account.name, { token: checked.token, portalId: account.portalId, uiDomain: account.uiDomain }, userId);
    return { ok: true, name: account.name };
  } catch (err) {
    return { error: `HubSpot: ${failure(err)}` };
  }
}

export async function connectJira(
  orgId: string,
  userId: string,
  input: { site: string; email: string; token: string; project: string; issueType: string },
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true; name: string } | { error: string }> {
  const site = jiraSite(input.site);
  if (!site) return { error: "Enter your Jira site, like acme.atlassian.net." };
  const project = projectKey(input.project);
  if (!project) return { error: "Enter the project's key, like SUP. It's the letters before the number in its issue keys." };
  const email = input.email.trim();
  const token = input.token.trim();
  if (!email || !token) return { error: "Enter the Jira account's email and an API token." };
  const creds: JiraCreds = { site, email, token, project, issueType: input.issueType.trim() || "Task" };
  try {
    const checked = await verifyJira(creds, fetcher);
    await save(orgId, "jira", `${site} · ${checked.project}`, { ...creds, issueType: checked.issueType }, userId);
    return { ok: true, name: `${checked.project}, as ${checked.issueType}` };
  } catch (err) {
    return { error: `Jira: ${failure(err)}` };
  }
}

async function noteError(id: string, error: string | null) {
  await db.update(integrations).set({ lastError: error, lastErrorAt: error ? new Date() : null }).where(eq(integrations.id, id));
}

export type Lookup<T> = { state: "off" } | { state: "error"; error: string } | { state: "ok"; data: T };

// Run from the ticket page. A failure is shown in the panel and on
// /app/integrations, never thrown: the ticket must still load.
export async function shopifyForCustomer(orgId: string, email: string, fetcher: typeof fetch = fetch): Promise<Lookup<ShopifyOrder[]> & { store?: string }> {
  const [row] = await db.select().from(integrations).where(and(eq(integrations.orgId, orgId), eq(integrations.kind, "shopify")));
  if (!row) return { state: "off" };
  try {
    const creds = unseal(row.credentials) as ShopifyCreds;
    const data = await shopifyOrders(creds, email, fetcher);
    if (row.lastError) await noteError(row.id, null);
    return { state: "ok", data, store: row.account };
  } catch (err) {
    const error = failure(err);
    await noteError(row.id, error);
    return { state: "error", error, store: row.account };
  }
}

export async function stripeForCustomer(orgId: string, email: string, fetcher: typeof fetch = fetch): Promise<Lookup<StripeCustomerView | null>> {
  const [row] = await db.select().from(integrations).where(and(eq(integrations.orgId, orgId), eq(integrations.kind, "stripe")));
  if (!row) return { state: "off" };
  try {
    const { key } = unseal(row.credentials);
    const data = await stripeCustomer(key, email, fetcher);
    if (row.lastError) await noteError(row.id, null);
    return { state: "ok", data };
  } catch (err) {
    const error = failure(err);
    await noteError(row.id, error);
    return { state: "error", error };
  }
}

export async function hubspotForCustomer(orgId: string, email: string, fetcher: typeof fetch = fetch): Promise<Lookup<HubSpotContact | null>> {
  const [row] = await db.select().from(integrations).where(and(eq(integrations.orgId, orgId), eq(integrations.kind, "hubspot")));
  if (!row) return { state: "off" };
  try {
    const creds = unseal(row.credentials) as { token: string; portalId: string; uiDomain: string };
    const data = await hubspotContact(creds, email, fetcher);
    if (row.lastError) await noteError(row.id, null);
    return { state: "ok", data };
  } catch (err) {
    const error = failure(err);
    await noteError(row.id, error);
    return { state: "error", error };
  }
}

// The Jira issues a ticket was escalated to, with their live status. "off"
// when Jira isn't connected and the ticket has none.
export async function jiraForTicket(orgId: string, ticketId: string, fetcher: typeof fetch = fetch): Promise<Lookup<JiraIssue[]>> {
  const [[row], links] = await Promise.all([
    db.select().from(integrations).where(and(eq(integrations.orgId, orgId), eq(integrations.kind, "jira"))),
    db
      .select()
      .from(schema.ticketLinks)
      .where(and(eq(schema.ticketLinks.orgId, orgId), eq(schema.ticketLinks.ticketId, ticketId), eq(schema.ticketLinks.kind, "jira")))
      .orderBy(asc(schema.ticketLinks.createdAt)),
  ]);
  const offline = links.map((l) => ({ key: l.externalKey, url: l.url, summary: "", status: "Jira isn't connected", done: false }));
  if (!row) return links.length ? { state: "ok", data: offline } : { state: "off" };
  if (links.length === 0) return { state: "ok", data: [] };
  try {
    return { state: "ok", data: await jiraIssues(unseal(row.credentials) as JiraCreds, links.map((l) => l.externalKey), fetcher) };
  } catch (err) {
    return { state: "error", error: failure(err) };
  }
}

// Makes a Jira issue from a ticket and links the two.
export async function escalateToJira(
  orgId: string,
  userId: string,
  ticket: { id: string; number: number },
  input: { summary: string; body: string; ticketUrl: string },
  fetcher: typeof fetch = fetch,
): Promise<{ key: string; url: string } | { error: string }> {
  const [row] = await db.select().from(integrations).where(and(eq(integrations.orgId, orgId), eq(integrations.kind, "jira")));
  if (!row) return { error: "Connect Jira on the Integrations page first." };
  try {
    const issue = await createJiraIssue(unseal(row.credentials) as JiraCreds, { ...input, ticketLabel: `ticket #${ticket.number}` }, fetcher);
    await db.insert(schema.ticketLinks).values({ orgId, ticketId: ticket.id, kind: "jira", externalKey: issue.key, url: issue.url, createdBy: userId }).onConflictDoNothing();
    if (row.lastError) await noteError(row.id, null);
    return issue;
  } catch (err) {
    const error = failure(err);
    await noteError(row.id, error);
    return { error };
  }
}
