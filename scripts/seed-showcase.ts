// Sample data for the homepage screenshots in public/product: a 4-agent coffee
// roaster with open tickets, AI answers and macros. Run after scripts/seed.ts,
// then start `DEV_AUTH=1 ANTHROPIC_API_KEY=test npm run dev` and capture
// /app/inbox, /app/overview, /app/tickets/1202, /app/receipts and /app/macros
// at 1280x740, 2x. It replaces the demo org's tickets, macros and AI events.
import { sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db";
import { createTicket, addReply } from "../src/lib/tickets";

const ORG = "org_dev";
const now = Date.now();
const ago = (min: number) => new Date(now - min * 60_000);
const month = new Date().toISOString().slice(0, 7);

async function main() {
  await db.execute(sql`delete from tickets where org_id = ${ORG}`);
  await db.execute(sql`delete from ai_events where org_id = ${ORG}`);
  await db.execute(sql`delete from macros where org_id = ${ORG}`);
  await db.execute(sql`update orgs set name = 'Northwind Coffee', next_ticket_number = 1201, onboarding = '{"dismissed":true}'::jsonb where id = ${ORG}`);
  await db
    .insert(schema.agents)
    .values([
      { orgId: ORG, userId: "user_ana", name: "Ana Ruiz", email: "ana@example.com", role: "agent" },
      { orgId: ORG, userId: "user_lee", name: "Lee Park", email: "lee@example.com", role: "agent" },
    ])
    .onConflictDoNothing();
  await db.execute(sql`update agents set name = 'Jo Okafor' where org_id = ${ORG} and user_id = 'user_dev'`);

  await db.insert(schema.macros).values([
    { orgId: ORG, name: "Refund timing", body: "Hi {{first_name}}, refunds go back to the original card within 5 business days. You'll get an email the moment it's sent.", addTags: ["refund"], setStatus: "closed", source: "suggested", question: "When will my refund reach my card?" },
    { orgId: ORG, name: "Pause a subscription", body: "Hi {{first_name}}, you can pause any time from Account › Subscription. Your next bag won't ship until you resume.", addTags: ["subscription"], setStatus: "closed" },
    { orgId: ORG, name: "Need order number", body: "Could you send me your order number? It's in the confirmation email we sent when you ordered.", setStatus: "pending" },
    { orgId: ORG, name: "Wholesale enquiry", body: "Thanks for your interest in stocking our beans! I've passed this to Lee, who looks after wholesale.", assignTo: "user_lee", addTags: ["wholesale"] },
  ]);

  type S = [string, string, string, string, "email" | "chat", string[], number, "ai" | "agent" | "none", string | null, "open" | "pending" | "closed"];
  const samples: S[] = [
    ["maria@hollowbrook.com", "Maria Chen", "Charged twice for my October bag", "Hi, I see two charges of $24 on my card this month. Can you refund one?", "email", ["billing"], 6, "none", "user_sam", "open"],
    ["tom@beckerdesign.co", "Tom Becker", "Grinder setting for the Ethiopia roast?", "Just got the Yirgacheffe. What grind do you recommend for a V60?", "chat", [], 11, "ai", null, "closed"],
    ["priya@shopmate.co", "Priya Nair", "Where is order #5531?", "It said 3–5 days and it's been 7. Tracking hasn't moved since Tuesday.", "email", ["shipping"], 18, "none", "user_ana", "open"],
    ["lee.h@fernway.org", "Hannah Lee", "Pause my subscription for a month", "We're travelling in November. Can I skip one delivery?", "email", ["subscription"], 26, "ai", null, "closed"],
    ["dev@acme.dev", "Jonas Berg", "Can't log in to my account", "The reset email never arrives. I've checked spam.", "chat", ["login"], 34, "none", null, "open"],
    ["sofia@casalinda.mx", "Sofía Ortega", "Wholesale pricing for our café", "We'd like to stock two of your blends. Do you have a price list?", "email", ["wholesale"], 52, "agent", "user_lee", "pending"],
    ["ben@arcwright.io", "Ben Arkwright", "When will my refund arrive?", "You said you'd refunded the damaged bag. How long does it take?", "email", ["refund"], 75, "ai", null, "closed"],
    ["nadia@kitekite.com", "Nadia Haddad", "Change my delivery address", "Moving next week, can the next bag go to my new place?", "chat", [], 96, "agent", "user_ana", "closed"],
    ["kai@tidepool.co", "Kai Nakamura", "Beans arrived crushed", "The bag split in transit and half of it is on the floor of the box.", "email", ["shipping"], 3, "none", "user_ana", "open"],
    ["rosa@brightleaf.es", "Rosa Martín", "Can I switch to decaf?", "Loving the subscription but I need to cut back. Can my next bag be decaf?", "chat", ["subscription"], 9, "none", null, "open"],
    ["oli@greybarn.uk", "Oliver Grey", "Gift card not working", "The code from my birthday card says invalid at checkout.", "email", ["billing"], 130, "none", "user_sam", "open"],
  ];
  for (const [email, name, subject, body, channel, tags, minAgo, reply, assignee, status] of samples) {
    const t = await createTicket({ orgId: ORG, channel, customerEmail: email, customerName: name, subject, body, authorType: "customer", tags });
    const at = ago(minAgo);
    await db.execute(sql`update tickets set created_at = ${at}, updated_at = ${at}, assignee_id = ${assignee}, status = ${status} where id = ${t.id}`);
    await db.execute(sql`update messages set created_at = ${at} where ticket_id = ${t.id}`);
    if (reply === "ai") {
      const body = subject.startsWith("Grinder")
        ? "Hi Tom, for a V60 we'd go medium-fine, about like table salt. Start with 15 g of coffee to 250 g of water at 94°C and adjust from there."
        : subject.startsWith("Pause")
          ? "Hi Hannah, you can pause any time from Account › Subscription. Your next bag won't ship until you resume."
          : "Hi Ben, refunds go back to the original card within 5 business days. You'll get an email the moment it's sent.";
      await db.insert(schema.messages).values({ orgId: ORG, ticketId: t.id, authorType: "ai", body, createdAt: new Date(at.getTime() + 40_000) });
      await db.execute(sql`update tickets set resolved_by_ai = true, first_response_at = ${new Date(at.getTime() + 40_000)} where id = ${t.id}`);
      await db.insert(schema.aiEvents).values({
        orgId: ORG, ticketId: t.id, kind: "resolution", month, model: "claude", createdAt: new Date(at.getTime() + 40_000),
        sources: subject.startsWith("Grinder") ? ["Brew guide: pour over"] : subject.startsWith("Pause") ? ["Pause a subscription"] : ["Refund timing"],
      });
    } else if (reply === "agent" && assignee) {
      await addReply({ orgId: ORG, ticketId: t.id, userId: assignee, body: "Thanks! I've sorted that for you. Let me know if anything else comes up.", internal: false });
    }
  }
  // Earlier AI answers this month, so the receipt and the meter have volume.
  const fill = Array.from({ length: 212 }, (_, i) => ({ orgId: ORG, kind: "resolution" as const, month, model: "claude", createdAt: ago(200 + i * 90), sources: ["Refund timing"] }));
  await db.insert(schema.aiEvents).values(fill);
  console.log("showcase seeded");
}

main().finally(() => pool.end());
