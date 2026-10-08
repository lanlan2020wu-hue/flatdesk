import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { connectGmail } from "@/lib/mailbox";
import { GmailError, readGmailState } from "@/lib/mailbox/gmail";
import { audit } from "@/lib/security";

// Google sends the admin back here after they allow access.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (notice: string) => redirect(`/app/settings?${new URLSearchParams({ mailbox: notice })}#mailbox`);
  const s = await requireAdmin();
  const state = readGmailState(url.searchParams.get("state") ?? "");
  // The same admin who started, on the same team, within a few minutes.
  if (!state || state.orgId !== s.orgId || state.userId !== s.userId) back("That Google link expired. Try Connect Gmail again.");
  const code = url.searchParams.get("code");
  if (!code) back(url.searchParams.get("error") === "access_denied" ? "Gmail wasn't connected." : "Google didn't finish signing in. Try again.");
  let notice = "connected";
  try {
    const { address } = await connectGmail(s.orgId, s.userId, code!);
    await audit(s.orgId, { userId: s.userId, name: s.name }, "integration.connect", `Gmail: ${address}`);
  } catch (err) {
    if (!(err instanceof GmailError)) console.error("gmail connect failed", err);
    notice = err instanceof GmailError ? err.message : "Google didn't finish signing in. Try again.";
  }
  back(notice);
}
