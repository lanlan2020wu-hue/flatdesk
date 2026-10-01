// A first guess at the team name from the sign-up email, so most people can
// just press Continue. Personal mailboxes say nothing about the company.
const PERSONAL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "zoho.com", "fastmail.com",
]);

export function teamNameFromEmail(email: string | null | undefined): string {
  const domain = email?.split("@")[1]?.trim().toLowerCase();
  if (!domain || PERSONAL.has(domain)) return "";
  // "mail.acme-labs.co.uk" → "acme-labs": drop subdomains and the public suffix.
  const parts = domain.split(".");
  const suffix = parts.length > 2 && parts[parts.length - 2].length <= 3 ? 2 : 1;
  const name = parts[parts.length - suffix - 1] ?? "";
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}
