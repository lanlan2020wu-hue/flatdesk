import { redirect } from "next/navigation";
import { requireAdmin, requireOpen } from "@/lib/auth";
import { microsoftAuthUrl, microsoftConfigured, microsoftState } from "@/lib/mailbox/microsoft";

// "Connect Outlook" in Settings: off to Microsoft to sign in to the support mailbox.
export async function GET() {
  const s = await requireOpen(await requireAdmin());
  if (!microsoftConfigured()) redirect("/app/settings#mailbox");
  redirect(microsoftAuthUrl(microsoftState(s.orgId, s.userId)));
}
