// The customer's HubSpot contact beside a ticket: who they are, their company,
// lifecycle stage and owner, with a link to the record. Matched by email.
//
// Teams paste the access token of a HubSpot private app (called legacy apps
// in newer accounts) with the crm.objects.contacts.read scope, plus
// crm.objects.companies.read for the company name and crm.objects.owners.read
// for the owner. Flatdesk only reads.

const API = "https://api.hubapi.com";
const TIMEOUT_MS = 5000;

export class HubSpotError extends Error {}

export type HubSpotContact = {
  id: string;
  name: string | null;
  title: string | null;
  phone: string | null;
  company: string | null;
  stage: string | null;
  leadStatus: string | null;
  owner: string | null;
  since: string | null;
  url: string;
};

export function checkHubSpotToken(raw: string): { token: string } | { error: string } {
  const token = raw.trim();
  if (!/^pat-[a-z0-9]+-[A-Za-z0-9-]{20,}$/.test(token)) return { error: "Paste the private app's access token. It starts with pat-." };
  return { token };
}

async function call<T>(token: string, path: string, fetcher: typeof fetch, body?: unknown): Promise<T> {
  const res = await fetcher(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401) throw new HubSpotError("HubSpot didn't accept the token. The app may have been deleted or the token rotated.");
  if (res.status === 403) throw new HubSpotError("The HubSpot app needs the crm.objects.contacts.read scope.");
  if (res.status === 429) throw new HubSpotError("HubSpot is rate limiting this app. Try again in a minute.");
  if (!res.ok) throw new HubSpotError(`HubSpot answered ${res.status}.`);
  return (await res.json()) as T;
}

type Account = { portalId: number; uiDomain?: string; companyName?: string };

// Checks the token can read contacts. Returns the account's name and what the
// ticket panel needs to link to records.
export async function verifyHubSpot(token: string, fetcher: typeof fetch = fetch): Promise<{ name: string; portalId: string; uiDomain: string }> {
  const account = await call<Account>(token, "/account-info/v3/details", fetcher);
  await call(token, "/crm/v3/objects/contacts?limit=1", fetcher);
  return { name: account.companyName || `HubSpot ${account.portalId}`, portalId: String(account.portalId), uiDomain: account.uiDomain || "app.hubspot.com" };
}

// HubSpot's internal values, like "salesqualifiedlead", in words.
const STAGES: Record<string, string> = {
  subscriber: "Subscriber",
  lead: "Lead",
  marketingqualifiedlead: "Marketing qualified lead",
  salesqualifiedlead: "Sales qualified lead",
  opportunity: "Opportunity",
  customer: "Customer",
  evangelist: "Evangelist",
  other: "Other",
};
const words = (v: string | null | undefined) => (v ? (STAGES[v] ?? v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ")) : null);

const PROPS = ["firstname", "lastname", "jobtitle", "phone", "company", "lifecyclestage", "hs_lead_status", "hubspot_owner_id", "associatedcompanyid", "createdate"];
type Props = Partial<Record<(typeof PROPS)[number], string | null>>;

export function toContact(id: string, p: Props, portal: { portalId: string; uiDomain: string }, extra: { company?: string | null; owner?: string | null } = {}): HubSpotContact {
  const name = [p.firstname, p.lastname].filter(Boolean).join(" ") || null;
  return {
    id,
    name,
    title: p.jobtitle || null,
    phone: p.phone || null,
    company: extra.company || p.company || null,
    stage: words(p.lifecyclestage),
    leadStatus: words(p.hs_lead_status),
    owner: extra.owner ?? null,
    since: p.createdate ? p.createdate.slice(0, 10) : null,
    url: `https://${portal.uiDomain}/contacts/${portal.portalId}/record/0-1/${id}`,
  };
}

export async function hubspotContact(creds: { token: string; portalId: string; uiDomain: string }, email: string, fetcher: typeof fetch = fetch): Promise<HubSpotContact | null> {
  const found = await call<{ results: { id: string; properties: Props }[] }>(creds.token, "/crm/v3/objects/contacts/search", fetcher, {
    filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
    properties: PROPS,
    limit: 1,
  });
  const c = found.results[0];
  if (!c) return null;
  const p = c.properties;
  // Both need their own scope; without it the panel still shows the contact.
  const [company, owner] = await Promise.all([
    p.associatedcompanyid
      ? call<{ properties: { name?: string | null } }>(creds.token, `/crm/v3/objects/companies/${encodeURIComponent(p.associatedcompanyid)}?properties=name`, fetcher)
          .then((r) => r.properties.name ?? null)
          .catch(() => null)
      : null,
    p.hubspot_owner_id
      ? call<{ firstName?: string; lastName?: string; email?: string }>(creds.token, `/crm/v3/owners/${encodeURIComponent(p.hubspot_owner_id)}`, fetcher)
          .then((o) => [o.firstName, o.lastName].filter(Boolean).join(" ") || o.email || null)
          .catch(() => null)
      : null,
  ]);
  return toContact(c.id, p, creds, { company, owner });
}
