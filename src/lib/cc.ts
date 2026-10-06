import { validEmail } from "@/lib/app-input";
import { emailConfig, parseAddress } from "@/lib/email";

// People copied on a ticket: everyone in an email's To and Cc except the
// customer, Flatdesk's own addresses and the team's own (support@ forwarded
// in, or a colleague at the same domain). Replies go to them too.

export const MAX_CC = 10;

const domainOf = (email: string) => email.split("@")[1] ?? "";

export function ccFromEmail(addresses: string[], opts: { customer: string; supportEmail: string | null }): string[] {
  const own = new Set([opts.customer.toLowerCase(), (emailConfig.from ?? "").toLowerCase()]);
  const teamDomain = opts.supportEmail ? domainOf(opts.supportEmail.toLowerCase()) : null;
  const out: string[] = [];
  for (const raw of addresses) {
    const { email } = parseAddress(raw);
    if (!email || !validEmail(email) || own.has(email) || out.includes(email)) continue;
    const domain = domainOf(email);
    if (domain === emailConfig.inboundDomain || (teamDomain && domain === teamDomain)) continue;
    out.push(email);
  }
  return out;
}

// "a@x.com, b@y.com" from the ticket rail. Returns the list or what's wrong.
export function parseCcList(raw: string, customer: string): string[] | { error: string } {
  const out: string[] = [];
  for (const part of raw.split(/[,;\s]+/).map((p) => p.trim().toLowerCase()).filter(Boolean)) {
    if (!validEmail(part)) return { error: `${part.slice(0, 80)} isn't an email address.` };
    if (part === customer.toLowerCase() || out.includes(part)) continue;
    out.push(part);
  }
  if (out.length > MAX_CC) return { error: `A ticket can copy up to ${MAX_CC} people.` };
  return out;
}

export const mergeCc = (a: string[], b: string[], customer: string) => [...new Set([...a, ...b])].filter((e) => e !== customer.toLowerCase()).slice(0, MAX_CC);
