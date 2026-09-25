// Demo data for local development: `DATABASE_URL=... npx tsx scripts/seed.ts`
import { db, pool, schema } from "../src/db";
import { createTicket } from "../src/lib/tickets";

const ORG = "org_dev";

async function main() {
  await db.insert(schema.orgs).values({ id: ORG, name: "Demo Support Team" }).onConflictDoNothing();
  await db
    .insert(schema.agents)
    .values([
      { orgId: ORG, userId: "user_dev", name: "Dev Agent", email: "dev@example.com", role: "admin" },
      { orgId: ORG, userId: "user_sam", name: "Sam Rivera", email: "sam@example.com", role: "agent" },
    ])
    .onConflictDoNothing();
  await db.insert(schema.macros).values([
    { orgId: ORG, name: "Refund issued", body: "I've issued a full refund. It should appear on your statement within 5–10 business days.", addTags: ["refund"], setStatus: "closed" },
    { orgId: ORG, name: "Need order number", body: "Could you send me your order number? It's in the confirmation email we sent when you ordered.", addTags: [], setStatus: "pending" },
  ]);
  await db.insert(schema.rules).values({ orgId: ORG, ifTag: "billing", assignTo: "user_sam" });

  const samples = [
    ["maria@northwind.io", "Maria Chen", "Charged twice for September", "Hi, I see two charges of $49 on my card for September. Can you refund one?", ["billing"]],
    ["dev@acme.dev", "Jonas Berg", "Can't reset my password", "The reset email never arrives. I've checked spam.", ["login"]],
    ["priya@shopmate.co", null, "Where is my order #4471?", "It said 3–5 days and it's been 9.", []],
  ] as const;
  for (const [email, name, subject, body, tags] of samples) {
    await createTicket({ orgId: ORG, channel: "email", customerEmail: email, customerName: name, subject, body, authorType: "customer", tags: [...tags] });
  }
  console.log("Seeded demo org with 3 tickets.");
}

main().finally(() => pool.end());
