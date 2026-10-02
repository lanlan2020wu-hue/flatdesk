import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Import credentials are stored encrypted while an import runs (it resumes
// across requests) and erased when it ends. IMPORT_SECRET sets the key and
// is required in production; development and tests fall back to a fixed key.
function key(): Buffer {
  let secret = process.env.IMPORT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") throw new Error("IMPORT_SECRET must be set to run imports in production.");
    secret = "flatdesk-dev";
  }
  return createHash("sha256").update(`flatdesk-import:${secret}`).digest();
}

const TAG_LENGTH = 16;

export function seal(value: Record<string, string>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv, { authTagLength: TAG_LENGTH });
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function unseal(sealed: string): Record<string, string> {
  const [iv, tag, data] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  // A short tag would make forging easier; GCM accepts them unless told the length.
  if (!iv || !tag || !data || tag.length !== TAG_LENGTH) throw new Error("Sealed credentials are malformed");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8"));
}
