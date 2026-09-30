// Where the site lives and who runs it. Moving to a custom domain is one
// environment variable (NEXT_PUBLIC_SITE_URL); the legal pages read the
// company details below from the environment too.

const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null;

export const SITE = {
  url: (process.env.NEXT_PUBLIC_SITE_URL || vercelUrl || "http://localhost:3000").replace(/\/$/, ""),
  // The business that sells Flatdesk, as it should appear in the terms.
  legalName: process.env.LEGAL_NAME || "Flatdesk",
  // Where customers write about accounts, billing, privacy and legal notices.
  contactEmail: process.env.CONTACT_EMAIL || "hello@flatdesk.app",
  // State or country whose law governs the terms, e.g. "the State of Delaware".
  governingLaw: process.env.GOVERNING_LAW || "the State of Delaware, USA",
};

export const LEGAL_UPDATED = "September 30, 2026";
