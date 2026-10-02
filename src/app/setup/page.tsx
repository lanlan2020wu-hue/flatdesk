import { redirect } from "next/navigation";
import Logo from "@/components/Logo";
import { clerkEnabled } from "@/lib/auth-config";
import TeamSetup from "@/components/TeamSetup";

export const metadata = { title: "Set up your team", robots: { index: false } };

export default function SetupPage() {
  // Without Clerk keys (local dev), sign-in is handled by DEV_AUTH.
  if (!clerkEnabled) redirect("/app");
  return (
    <div className="mx-auto grid max-w-3xl gap-8 px-4 py-12">
      <div className="grid gap-3">
        <Logo />
        <p className="eyebrow">Step 1 of 5</p>
        <h1 className="font-display text-4xl">Set up your support team</h1>
        <p className="text-muted">You&apos;ll invite teammates on the next screen. Each teammate you add is one seat. Viewers, who can read but not reply, aren&apos;t billed.</p>
      </div>
      <TeamSetup />
    </div>
  );
}
