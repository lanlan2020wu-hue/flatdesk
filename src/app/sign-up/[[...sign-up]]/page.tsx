import { redirect } from "next/navigation";
import AuthShell from "@/components/AuthShell";
import { clerkEnabled } from "@/lib/auth-config";
import { SignUp } from "@clerk/nextjs";

export const metadata = { title: "Start your free trial" };

export default function SignUpPage() {
  // Without Clerk keys (local dev), sign-in is handled by DEV_AUTH.
  if (!clerkEnabled) redirect("/app");
  return (
    <AuthShell title="Create your Flatdesk account">
      <SignUp forceRedirectUrl="/setup" />
    </AuthShell>
  );
}
