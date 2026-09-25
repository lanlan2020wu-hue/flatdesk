import { redirect } from "next/navigation";
import Logo from "@/components/Logo";
import { clerkEnabled } from "@/lib/auth-config";
import { CreateOrganization, OrganizationList } from "@clerk/nextjs";

export const metadata = { title: "Set up your team" };

export default function SetupPage() {
  // Without Clerk keys (local dev), sign-in is handled by DEV_AUTH.
  if (!clerkEnabled) redirect("/app");
  return (
    <div className="mx-auto grid max-w-3xl gap-8 px-4 py-12">
      <div className="grid gap-3">
        <Logo />
        <p className="eyebrow">Step 1 of 5</p>
        <h1 className="font-display text-4xl">Set up your support team</h1>
        <p className="text-muted">Create a team for your company, or join one you&apos;ve been invited to. Each teammate you add is one seat.</p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <OrganizationList hidePersonal afterSelectOrganizationUrl="/app" afterCreateOrganizationUrl="/app/welcome" />
        {/* Invites happen on the next screen, alongside importing and connecting email. */}
        <CreateOrganization afterCreateOrganizationUrl="/app/welcome" skipInvitationScreen />
      </div>
    </div>
  );
}
