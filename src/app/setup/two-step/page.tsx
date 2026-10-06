import Link from "next/link";
import { redirect } from "next/navigation";
import { UserProfile } from "@clerk/nextjs";
import Logo from "@/components/Logo";
import { clerkEnabled } from "@/lib/auth-config";

export const metadata = { title: "Turn on two-step verification", robots: { index: false } };

// Where requireSession sends people whose team requires two-step verification
// and who haven't turned it on yet. Clerk's account screen does the setup.
export default function TwoStepPage() {
  if (!clerkEnabled) redirect("/app");
  return (
    <div className="mx-auto grid max-w-3xl gap-8 px-4 py-12">
      <div className="grid gap-3">
        <Logo />
        <h1 className="font-display text-4xl">Turn on two-step verification</h1>
        <p className="text-muted">
          Your team requires it before anyone opens the help desk. Under Security below, add an authenticator app. Then you&apos;re in.
        </p>
        <Link href="/app" className="btn btn-primary w-max">I&apos;ve turned it on</Link>
      </div>
      <UserProfile routing="hash" />
    </div>
  );
}
