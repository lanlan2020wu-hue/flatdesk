// Ids that arrive in URLs and forms are checked before they reach a uuid
// column: Postgres throws on anything that isn't a real uuid, which would be a
// 500 instead of "not found".
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Postgres rejects text and jsonb holding a NUL byte; it throws instead of storing it.
// Anything typed or sent in by the public goes through this before it's saved.
export const noNul = (s: string) => s.replace(/\0/g, "");

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
