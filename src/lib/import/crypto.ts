import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Import credentials are stored encrypted while an import runs (it resumes
// across requests) and erased when it ends. IMPORT_SECRET sets the key; it
// falls back to Clerk's secret so production works without a new variable.
function key(): Buffer {
  const secret = process.env.IMPORT_SECRET || process.env.CLERK_SECRET_KEY || process.env.DATABASE_URL || "flatdesk-dev";
  return createHash("sha256").update(`flatdesk-import:${secret}`).digest();
}

export function seal(value: Record<string, string>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function unseal(sealed: string): Record<string, string> {
  const [iv, tag, data] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8"));
}
