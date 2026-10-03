import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireOpenPage } from "@/lib/auth";

// Tickets aren't typed in by the team: they start in the chat window, where the
// customer gives their name and email each time and the AI answers.
export default async function NewTicketPage() {
  const s = await requireOpenPage();
  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, s.orgId), columns: { widgetKey: true } });
  redirect(org ? `/chat/${org.widgetKey}?new` : "/app/inbox");
}
