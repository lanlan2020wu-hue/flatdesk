import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { json, withKey } from "@/lib/api";

// Who a key belongs to. Zapier and Make call this to test a connection.
export async function GET(request: Request) {
  return withKey(request, async (caller) => {
    const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, caller.orgId) });
    const key = await db.query.apiKeys.findFirst({ where: eq(schema.apiKeys.id, caller.keyId) });
    return json({ team: org?.name ?? null, key: key?.name ?? null, locked: caller.locked });
  });
}
