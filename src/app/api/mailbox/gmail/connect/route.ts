import { redirect } from "next/navigation";
import { requireAdmin, requireOpen } from "@/lib/auth";
import { gmailAuthUrl, gmailConfigured, gmailState } from "@/lib/mailbox/gmail";

// "Connect Gmail" in Settings: off to Google to sign in to the support mailbox.
export async function GET() {
  const s = await requireOpen(await requireAdmin());
  if (!gmailConfigured()) redirect("/app/settings#mailbox");
  redirect(gmailAuthUrl(gmailState(s.orgId, s.userId)));
}
