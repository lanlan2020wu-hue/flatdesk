// Merging two customer records that are the same person (jo@acme.com and
// jo.smith@acme.com): every ticket moves to the one that stays, their notes
// and fields are combined, and the other record goes away.

import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";

const { customers, tickets, messages } = schema;

export class CustomerMergeError extends Error {}

export async function mergeCustomers(orgId: string, fromId: string, intoEmail: string): Promise<{ email: string }> {
  const email = intoEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CustomerMergeError("Enter the email address of the customer to keep.");
  return db.transaction(async (tx) => {
    const [from] = await tx.select().from(customers).where(and(eq(customers.orgId, orgId), eq(customers.id, fromId))).for("update");
    const [into] = await tx.select().from(customers).where(and(eq(customers.orgId, orgId), eq(customers.email, email))).for("update");
    if (!from) throw new CustomerMergeError("That customer no longer exists.");
    if (!into) throw new CustomerMergeError(`There's no customer with the email ${email}. They need at least one ticket first.`);
    if (into.id === from.id) throw new CustomerMergeError("That's the same customer.");

    const moved = await tx.select({ id: tickets.id }).from(tickets).where(and(eq(tickets.orgId, orgId), eq(tickets.customerId, from.id)));
    await tx.update(tickets).set({ customerId: into.id }).where(and(eq(tickets.orgId, orgId), eq(tickets.customerId, from.id)));
    // Messages they wrote point at them by id.
    await tx.update(messages).set({ authorId: into.id }).where(and(eq(messages.orgId, orgId), eq(messages.authorType, "customer"), eq(messages.authorId, from.id)));
    // Their old address stays on as a copy on those tickets, so mail from it still finds the ticket.
    if (moved.length) {
      await tx
        .update(tickets)
        .set({ cc: sql`array_append(${tickets.cc}, ${from.email})` })
        .where(and(inArray(tickets.id, moved.map((t) => t.id)), sql`not (${from.email} = any(${tickets.cc}))`));
    }
    const notes = [into.notes, from.notes && `From ${from.email}:\n${from.notes}`].filter(Boolean).join("\n\n").slice(0, 2000);
    await tx
      .update(customers)
      .set({ name: into.name ?? from.name, notes, vip: into.vip || from.vip, fields: { ...from.fields, ...into.fields } })
      .where(eq(customers.id, into.id));
    await tx.delete(customers).where(eq(customers.id, from.id));
    return { email: into.email };
  });
}
