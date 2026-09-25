import { redirect } from "next/navigation";
import Logo from "@/components/Logo";
import { clerkEnabled } from "@/lib/auth-config";
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  // Without Clerk keys (local dev), sign-in is handled by DEV_AUTH.
  if (!clerkEnabled) redirect("/app");
  return (
    <div className="grid flex-1 content-center justify-items-center gap-8 px-4 py-12">
      <Logo />
      <SignIn forceRedirectUrl="/app" />
    </div>
  );
}
