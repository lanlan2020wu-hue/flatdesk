// What the team knows about one customer: free-form notes ("prefers phone",
// "annual plan, renews March") and a VIP flag. Notes show beside every ticket
// from them; VIP puts a badge on their tickets in the inbox and on the ticket.

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";

const { customers } = schema;

export const CUSTOMER_NOTES_MAX = 2000;

export class CustomerProfileError extends Error {}

// Notes as typed: line endings tidied, trailing space dropped, capped in length.
export function cleanCustomerNotes(raw: unknown): string {
  const text = String(raw ?? "").replace(/\0/g, "").replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();
  if (text.length > CUSTOMER_NOTES_MAX) throw new CustomerProfileError(`Notes can be up to ${CUSTOMER_NOTES_MAX} characters. Yours has ${text.length}.`);
  return text;
}

export async function saveCustomerProfile(orgId: string, customerId: string, input: { notes: unknown; vip: boolean }) {
  const notes = cleanCustomerNotes(input.notes);
  const [row] = await db
    .update(customers)
    .set({ notes, vip: input.vip })
    .where(and(eq(customers.orgId, orgId), eq(customers.id, customerId)))
    .returning({ id: customers.id });
  if (!row) throw new CustomerProfileError("That customer no longer exists.");
}
