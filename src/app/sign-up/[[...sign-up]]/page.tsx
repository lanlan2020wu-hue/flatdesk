import Link from "next/link";
import { redirect } from "next/navigation";
import AuthShell from "@/components/AuthShell";
import { clerkEnabled } from "@/lib/auth-config";
import { TRIAL_DAYS } from "@/lib/billing";
import { SignUp } from "@clerk/nextjs";

export const metadata = { title: "Start your free trial", robots: { index: false } };

export default function SignUpPage() {
  // Without Clerk keys (local dev), sign-in is handled by DEV_AUTH.
  if (!clerkEnabled) redirect("/app");
  return (
    <AuthShell title="Create your Flatdesk account">
      <p className="text-sm text-muted">{TRIAL_DAYS} days free. No card needed to start.</p>
      <SignUp forceRedirectUrl="/setup" />
      <p className="max-w-sm text-center text-xs text-muted">
        By creating an account you agree to the <Link href="/terms" className="link">terms of service</Link> and{" "}
        <Link href="/privacy" className="link">privacy policy</Link>.
      </p>
    </AuthShell>
  );
}
