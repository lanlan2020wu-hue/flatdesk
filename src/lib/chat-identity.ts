import { createHmac, timingSafeEqual } from "node:crypto";

// Chat for signed-in users. The team's own server signs the user's email with
// the team's chat secret (Settings, Website chat) and puts it on the page:
//
//   window.FlatdeskSettings = { email, name, userHash: HMAC-SHA256(secret, email) as hex, attributes: { Plan: "Pro" } };
//
// widget.js hands these to the chat window, which skips the name and email
// form. Flatdesk checks the hash: a match means the visitor really is that
// signed-in user, so the ticket says "verified" and keeps the attributes.
// Without a match the email is treated like any typed one.

export const MAX_ATTRIBUTES = 10;
export const VERIFIED_FIELD = "Signed in on your site";

export function userHash(secret: string, email: string): string {
  return createHmac("sha256", secret).update(email.trim().toLowerCase()).digest("hex");
}

export function verifyUserHash(secret: string, email: string, hash: unknown): boolean {
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/i.test(hash)) return false;
  const want = Buffer.from(userHash(secret, email), "hex");
  return timingSafeEqual(want, Buffer.from(hash.toLowerCase(), "hex"));
}

// Up to 10 short label -> value pairs, shown on the ticket. Anything else is dropped.
export function cleanAttributes(raw: unknown): Record<string, string> {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_ATTRIBUTES) break;
    const key = String(k).replace(/\0/g, "").trim().slice(0, 60);
    if (!key || key === VERIFIED_FIELD || (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean")) continue;
    out[key] = String(v).replace(/\0/g, "").trim().slice(0, 200);
  }
  return out;
}

// The fields a chat ticket gets from the visitor's identity.
export function identityFields(secret: string, email: string, hash: unknown, attributes: unknown): Record<string, string> {
  if (hash === undefined || hash === null || hash === "") return {};
  if (!verifyUserHash(secret, email, hash)) return { [VERIFIED_FIELD]: "No: the identity check failed, so treat the email as unconfirmed" };
  return { [VERIFIED_FIELD]: `Yes, as ${email}`, ...cleanAttributes(attributes) };
}
