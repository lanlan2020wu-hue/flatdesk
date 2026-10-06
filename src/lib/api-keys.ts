import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { access } from "@/lib/billing";

// Keys for the REST API (/api/v1). A key is "fd_" plus 32 random bytes; only
// its SHA-256 hash is stored, so a leaked database doesn't leak working keys.
// Admins make and revoke keys on /app/integrations.

const { apiKeys, orgs } = schema;
export const MAX_KEYS = 20;
const PREFIX_LENGTH = 11; // "fd_" and 8 characters, enough to tell keys apart

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export async function createApiKey(orgId: string, userId: string, rawName: string): Promise<{ key: string } | { error: string }> {
  const name = rawName.trim().slice(0, 60) || "API key";
  const live = await db.select({ id: apiKeys.id }).from(apiKeys).where(and(eq(apiKeys.orgId, orgId), isNull(apiKeys.revokedAt)));
  if (live.length >= MAX_KEYS) return { error: `A team can have up to ${MAX_KEYS} keys. Revoke one you don't use first.` };
  const key = `fd_${randomBytes(32).toString("base64url")}`;
  await db.insert(apiKeys).values({ orgId, name, prefix: key.slice(0, PREFIX_LENGTH), hash: hashKey(key), createdBy: userId });
  return { key };
}

export async function revokeApiKey(orgId: string, id: string) {
  await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.orgId, orgId), eq(apiKeys.id, id), isNull(apiKeys.revokedAt)));
}

export async function listApiKeys(orgId: string) {
  return db.select().from(apiKeys).where(and(eq(apiKeys.orgId, orgId), isNull(apiKeys.revokedAt))).orderBy(desc(apiKeys.createdAt));
}

export type ApiCaller = { orgId: string; keyId: string; createdBy: string; locked: boolean };

// The team behind an "Authorization: Bearer fd_..." header, or null.
export async function authenticate(request: Request): Promise<ApiCaller | null> {
  const header = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(fd_[A-Za-z0-9_-]{20,100})\s*$/.exec(header);
  if (!m) return null;
  const [row] = await db
    .select({ key: apiKeys, org: orgs })
    .from(apiKeys)
    .innerJoin(orgs, eq(orgs.id, apiKeys.orgId))
    .where(and(eq(apiKeys.hash, hashKey(m[1])), isNull(apiKeys.revokedAt)));
  if (!row) return null;
  // "Last used" is for spotting unused keys, so once a minute is enough.
  const now = new Date();
  await db
    .update(apiKeys)
    .set({ lastUsedAt: now })
    .where(and(eq(apiKeys.id, row.key.id), or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, new Date(now.getTime() - 60_000)))));
  return { orgId: row.org.id, keyId: row.key.id, createdBy: row.key.createdBy, locked: access(row.org).state === "locked" };
}
