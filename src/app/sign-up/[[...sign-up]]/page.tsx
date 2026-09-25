import { redirect } from "next/navigation";
import { clerkEnabled } from "@/lib/auth-config";
import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  // Without Clerk keys (local dev), sign-in is handled by DEV_AUTH.
  if (!clerkEnabled) redirect("/app");
  return (
    <div className="grid flex-1 place-items-center px-4 py-12">
      <SignUp forceRedirectUrl="/setup" />
    </div>
  );
}
