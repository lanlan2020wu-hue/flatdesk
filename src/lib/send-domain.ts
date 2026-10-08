import { and, eq, isNull, lt, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SendDomainRecord } from "@/db/schema";
import { emailConfig, resend } from "@/lib/email";
import { SITE } from "@/lib/site";

// Replies from the team's own address, like support@acme.com, instead of the
// shared EMAIL_FROM. The team's domain is added to Flatdesk's Resend account,
// the team adds the DNS records Resend gives (DKIM, and SPF on a "send"
// subdomain, so their existing mail setup is untouched), and once Resend sees
// them replies go out from that address. Customer replies still come back
// through the Reply-To, so threading works the same either way.

const { orgs } = schema;

// Mailbox providers whose domains nobody can add records to.
const SHARED = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.de", "web.de", "mail.com", "zoho.com", "yandex.com", "yandex.ru", "qq.com", "163.com",
]);

// A team that starts setting up a domain and never finishes doesn't keep it
// from the domain's real owner forever.
export const UNVERIFIED_HOLD_MS = 3 * 24 * 3600_000;

export const SEND_ADDRESS_RULE = "an address at your own domain, like support@yourcompany.com";

// "Support@Acme.com " -> { address: "support@acme.com", domain: "acme.com" }, or null.
export function parseSendAddress(input: string): { address: string; domain: string } | null {
  const s = input.trim().toLowerCase();
  const m = /^([a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?)@([a-z0-9.-]{3,253})$/.exec(s);
  if (!m || m[1].includes("..")) return null;
  const domain = m[2].replace(/\.$/, "");
  const labels = domain.split(".");
  if (labels.length < 2 || !labels.every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) || /^\d+$/.test(labels.at(-1)!)) return null;
  if (SHARED.has(domain)) return null;
  const own = [new URL(SITE.url).hostname.replace(/^www\./, ""), emailConfig.from?.split("@")[1], emailConfig.inboundDomain].filter(Boolean) as string[];
  if (own.some((d) => domain === d || domain.endsWith(`.${d}`) || d.endsWith(`.${domain}`))) return null;
  return { address: `${m[1]}@${domain}`, domain };
}

export const sendDomainsConfigured = () => Boolean(emailConfig.apiKey && emailConfig.from);

export class SendDomainError extends Error {}

// Resend's domains API; tests pass a fake.
type Domains = Pick<ReturnType<typeof resend>["domains"], "create" | "get" | "verify" | "remove">;
type Opts = { now?: Date; domains?: Domains };

type ResendRecord = { record: string; type: string; name: string; value: string; priority?: number; status: string };
const records = (rows: ResendRecord[]): SendDomainRecord[] =>
  rows.filter((r) => r.record === "SPF" || r.record === "DKIM").map((r) => ({ type: r.type, name: r.name, value: r.value, priority: r.priority, status: r.status }));

// Starts sending from `address` (or stops, with null). Returns the records to add.
export async function setSendAddress(orgId: string, input: string | null, { now = new Date(), domains: given }: Opts = {}): Promise<{ records: SendDomainRecord[] } | null> {
  const domains = given ?? (emailConfig.apiKey ? resend().domains : null);
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, orgId) });
  if (!org) throw new SendDomainError("No such team.");
  if (!input) {
    if (org.sendDomainId) await removeFromResend(domains, org.sendDomainId);
    await db
      .update(orgs)
      .set({ sendAddress: null, sendDomain: null, sendDomainId: null, sendDomainRecords: null, sendDomainAddedAt: null, sendDomainVerifiedAt: null })
      .where(eq(orgs.id, orgId));
    return null;
  }
  const parsed = parseSendAddress(input);
  if (!parsed) throw new SendDomainError(`Use ${SEND_ADDRESS_RULE}. Shared providers like Gmail can't be used.`);
  if (!domains || (!given && !sendDomainsConfigured())) throw new SendDomainError("Email isn't connected on this server yet.");

  // Same domain, new mailbox name: nothing to set up again.
  if (org.sendDomain === parsed.domain) {
    await db.update(orgs).set({ sendAddress: parsed.address }).where(eq(orgs.id, orgId));
    return { records: org.sendDomainRecords ?? [] };
  }

  // Another team's half-finished setup of this domain is released after a few days.
  const [holder] = await db.select().from(orgs).where(and(eq(orgs.sendDomain, parsed.domain), ne(orgs.id, orgId)));
  if (holder) {
    const stale = !holder.sendDomainVerifiedAt && holder.sendDomainAddedAt && now.getTime() - holder.sendDomainAddedAt.getTime() > UNVERIFIED_HOLD_MS;
    if (!stale) throw new SendDomainError(`${parsed.domain} is already used by another Flatdesk team.`);
    if (holder.sendDomainId) await removeFromResend(domains, holder.sendDomainId);
    await db
      .update(orgs)
      .set({ sendAddress: null, sendDomain: null, sendDomainId: null, sendDomainRecords: null, sendDomainAddedAt: null })
      .where(and(eq(orgs.id, holder.id), isNull(orgs.sendDomainVerifiedAt), lt(orgs.sendDomainAddedAt, new Date(now.getTime() - UNVERIFIED_HOLD_MS))));
  }

  const { data, error } = await domains.create({ name: parsed.domain });
  if (error || !data) {
    console.error("resend domain create failed", parsed.domain, error);
    throw new SendDomainError(
      /already|registered|exists/i.test(error?.message ?? "")
        ? `${parsed.domain} is already set up for sending somewhere else. Remove it there first, or use a subdomain like support@mail.${parsed.domain}.`
        : "That address couldn't be set up. Check it's spelled right and try again.",
    );
  }
  const rows = records(data.records as ResendRecord[]);
  try {
    await db
      .update(orgs)
      .set({ sendAddress: parsed.address, sendDomain: parsed.domain, sendDomainId: data.id, sendDomainRecords: rows, sendDomainAddedAt: now, sendDomainVerifiedAt: null })
      .where(eq(orgs.id, orgId));
  } catch (err) {
    await removeFromResend(domains, data.id);
    if ((err as { code?: string }).code === "23505") throw new SendDomainError(`${parsed.domain} is already used by another Flatdesk team.`);
    throw err;
  }
  if (org.sendDomainId) await removeFromResend(domains, org.sendDomainId);
  return { records: rows };
}

// Asks Resend to look for the records and saves what it finds.
export async function checkSendDomain(orgId: string, opts: Opts = {}): Promise<"verified" | "pending" | "unknown"> {
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, orgId) });
  if (!org?.sendDomainId) return "unknown";
  const now = opts.now ?? new Date();
  try {
    const domains = opts.domains ?? resend().domains;
    if (!org.sendDomainVerifiedAt) await domains.verify(org.sendDomainId);
    const { data, error } = await domains.get(org.sendDomainId);
    if (error || !data) return "unknown";
    const verified = data.status === "verified";
    await db
      .update(orgs)
      .set({ sendDomainRecords: records(data.records as ResendRecord[]), sendDomainVerifiedAt: verified ? (org.sendDomainVerifiedAt ?? now) : null })
      .where(eq(orgs.id, orgId));
    return verified ? "verified" : "pending";
  } catch (err) {
    console.error("resend domain check failed", org.sendDomain, err);
    return "unknown";
  }
}

async function removeFromResend(domains: Domains | null, id: string) {
  if (!domains) return;
  try {
    const { error } = await domains.remove(id);
    if (error) console.error("resend domain remove failed", id, error);
  } catch (err) {
    console.error("resend domain remove failed", id, err);
  }
}
