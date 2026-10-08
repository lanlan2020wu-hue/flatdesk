import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { connectMicrosoft } from "@/lib/mailbox";
import { MicrosoftError, readMicrosoftState } from "@/lib/mailbox/microsoft";
import { audit } from "@/lib/security";

// Microsoft sends the admin back here after they allow access.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (notice: string) => redirect(`/app/settings?${new URLSearchParams({ mailbox: notice })}#mailbox`);
  const s = await requireAdmin();
  const state = readMicrosoftState(url.searchParams.get("state") ?? "");
  // The same admin who started, on the same team, within a few minutes.
  if (!state || state.orgId !== s.orgId || state.userId !== s.userId) back("That Microsoft link expired. Try Connect Outlook again.");
  const code = url.searchParams.get("code");
  if (!code) back(url.searchParams.get("error") === "access_denied" ? "Outlook wasn't connected." : "Microsoft didn't finish signing in. Try again.");
  let notice = "connected";
  try {
    const { address } = await connectMicrosoft(s.orgId, s.userId, code!);
    await audit(s.orgId, { userId: s.userId, name: s.name }, "integration.connect", `Outlook: ${address}`);
  } catch (err) {
    if (!(err instanceof MicrosoftError)) console.error("microsoft connect failed", err);
    notice = err instanceof MicrosoftError ? err.message : "Microsoft didn't finish signing in. Try again.";
  }
  back(notice);
}
