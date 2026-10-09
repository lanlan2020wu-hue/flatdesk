// Custom ticket fields: an admin defines fields like "Plan" (a dropdown),
// "Order number" (text) or "Refund issued" (a checkbox), and every ticket gets
// them in its rail. A field can be required before the team closes a ticket.
//
// Values are kept in tickets.fields under the field's name, the same map that
// holds fields kept from an import. So a Zendesk "Plan" field becomes
// editable as soon as a "Plan" field is defined here, renaming a field moves
// its values, and deleting one leaves the values on old tickets, read only.

import { and, asc, count, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";

export const FIELD_LIMITS = { max: 20, nameChars: 40, options: 50, optionChars: 60, valueChars: 500 };
export const FIELD_KINDS = [
  { id: "text", label: "Text" },
  { id: "number", label: "Number" },
  { id: "dropdown", label: "Dropdown" },
  { id: "checkbox", label: "Checkbox" },
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number]["id"];
export type TicketField = typeof schema.ticketFields.$inferSelect;

// What a checked checkbox is stored as. Unchecked is no value at all.
export const CHECKED = "Yes";
// Keys Flatdesk itself writes into tickets.fields; never a field name.
const RESERVED = new Set(["imported from"]);

export class FieldError extends Error {}

const { ticketFields, tickets } = schema;

const isKind = (k: string): k is FieldKind => FIELD_KINDS.some((x) => x.id === k);

export function parseFieldInput(get: (key: string) => string): { name: string; kind: FieldKind; options: string[]; requiredToClose: boolean } {
  const name = get("name").replace(/\s+/g, " ").trim();
  if (!name) throw new FieldError("Give the field a name.");
  if (name.length > FIELD_LIMITS.nameChars) throw new FieldError(`A field name can be up to ${FIELD_LIMITS.nameChars} characters.`);
  if (RESERVED.has(name.toLowerCase())) throw new FieldError(`"${name}" is used by Flatdesk. Pick another name.`);
  const kind = get("kind");
  if (!isKind(kind)) throw new FieldError("Pick what kind of field it is.");
  let options: string[] = [];
  if (kind === "dropdown") {
    options = [...new Set(get("options").split(/[,\n]/).map((o) => o.replace(/\s+/g, " ").trim()).filter(Boolean))];
    if (options.length < 2) throw new FieldError("A dropdown needs at least two choices, separated by commas.");
    if (options.length > FIELD_LIMITS.options) throw new FieldError(`A dropdown can have up to ${FIELD_LIMITS.options} choices.`);
    if (options.some((o) => o.length > FIELD_LIMITS.optionChars)) throw new FieldError(`Each choice can be up to ${FIELD_LIMITS.optionChars} characters.`);
  }
  return { name, kind, options, requiredToClose: get("requiredToClose") === "on" };
}

// A value typed or picked on a ticket, as stored. Null clears it.
export function cleanValue(field: Pick<TicketField, "name" | "kind" | "options">, raw: string): string | null {
  const v = raw.replace(/\0/g, "").trim();
  if (field.kind === "checkbox") return v === "on" || v === CHECKED ? CHECKED : null;
  if (!v) return null;
  if (field.kind === "number") {
    const n = Number(v.replace(/,/g, ""));
    if (!Number.isFinite(n)) throw new FieldError(`${field.name} has to be a number.`);
    return String(n);
  }
  if (field.kind === "dropdown") {
    if (!field.options.includes(v)) throw new FieldError(`${v} isn't one of the choices for ${field.name}.`);
    return v;
  }
  return v.slice(0, FIELD_LIMITS.valueChars);
}

// Required fields still empty on a ticket.
export function missingRequired(fields: Pick<TicketField, "name" | "requiredToClose">[], values: Record<string, string>) {
  return fields.filter((f) => f.requiredToClose && !values[f.name]?.trim()).map((f) => f.name);
}

export function missingMessage(names: string[]) {
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `Fill in ${list} before closing this ticket.`;
}

export async function listFields(orgId: string) {
  return db.select().from(ticketFields).where(eq(ticketFields.orgId, orgId)).orderBy(asc(ticketFields.position), asc(ticketFields.createdAt));
}

function unique(err: unknown): never {
  const e = err as { code?: string; cause?: { code?: string } };
  if ((e?.code ?? e?.cause?.code) === "23505") throw new FieldError("There's already a field with that name.");
  throw err;
}

export async function addField(orgId: string, input: ReturnType<typeof parseFieldInput>) {
  const [{ n }] = await db.select({ n: count() }).from(ticketFields).where(eq(ticketFields.orgId, orgId));
  if (Number(n) >= FIELD_LIMITS.max) throw new FieldError(`A team can have up to ${FIELD_LIMITS.max} fields.`);
  const [row] = await db
    .insert(ticketFields)
    .values({ orgId, ...input, position: Number(n) })
    .returning()
    .catch(unique);
  return row;
}

// Saves a field's changes. A new name carries the values on every ticket over to it.
export async function updateField(orgId: string, id: string, input: ReturnType<typeof parseFieldInput>) {
  return db
    .transaction(async (tx) => {
      const [before] = await tx.select().from(ticketFields).where(and(eq(ticketFields.orgId, orgId), eq(ticketFields.id, id))).for("update");
      if (!before) throw new FieldError("That field was deleted.");
      const [row] = await tx.update(ticketFields).set(input).where(eq(ticketFields.id, id)).returning();
      if (before.name !== input.name) {
        await tx
          .update(tickets)
          .set({ fields: sql`(${tickets.fields} - ${before.name}::text) || jsonb_build_object(${input.name}::text, ${tickets.fields} -> ${before.name}::text)` })
          .where(and(eq(tickets.orgId, orgId), sql`${tickets.fields} ? ${before.name}::text`));
      }
      return { before, row };
    })
    .catch(unique);
}

export async function deleteField(orgId: string, id: string) {
  const [row] = await db.delete(ticketFields).where(and(eq(ticketFields.orgId, orgId), eq(ticketFields.id, id))).returning({ name: ticketFields.name });
  return row ?? null;
}

// Saves the values from a ticket's rail. Only defined fields change; values
// kept from an import that no field covers stay as they are.
export async function setTicketValues(orgId: string, ticketId: string, get: (name: string) => string | null) {
  const defs = await listFields(orgId);
  return db.transaction(async (tx) => {
    const [t] = await tx.select({ fields: tickets.fields }).from(tickets).where(and(eq(tickets.orgId, orgId), eq(tickets.id, ticketId))).for("update");
    if (!t) throw new FieldError("That ticket doesn't exist.");
    const next = { ...t.fields };
    for (const f of defs) {
      const raw = get(f.name);
      if (raw === null && f.kind !== "checkbox") continue;
      const v = cleanValue(f, raw ?? "");
      if (v === null) delete next[f.name];
      else next[f.name] = v;
    }
    await tx.update(tickets).set({ fields: next, updatedAt: new Date() }).where(eq(tickets.id, ticketId));
    return next;
  });
}

// Before the team closes tickets: the ones whose required fields are empty.
export async function blockedFromClosing(orgId: string, ticketIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const defs = (await listFields(orgId)).filter((f) => f.requiredToClose);
  if (!defs.length || !ticketIds.length) return out;
  const rows = await db
    .select({ id: tickets.id, fields: tickets.fields })
    .from(tickets)
    .where(and(eq(tickets.orgId, orgId), sql`${tickets.id} in (${sql.join(ticketIds.map((id) => sql`${id}::uuid`), sql`, `)})`));
  for (const r of rows) {
    const missing = missingRequired(defs, r.fields);
    if (missing.length) out.set(r.id, missing);
  }
  return out;
}
