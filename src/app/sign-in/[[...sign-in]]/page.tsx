import { redirect } from "next/navigation";
import AuthShell from "@/components/AuthShell";
import { clerkEnabled } from "@/lib/auth-config";
import { SignIn } from "@clerk/nextjs";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
  // Without Clerk keys (local dev), sign-in is handled by DEV_AUTH.
  if (!clerkEnabled) redirect("/app");
  return (
    <AuthShell title="Sign in to Flatdesk">
      <SignIn forceRedirectUrl="/app" />
    </AuthShell>
  );
}
