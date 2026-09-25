import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { clerkEnabled } from "@/lib/auth-config";

export default function AccountMenu({ fallbackName }: { fallbackName: string }) {
  if (!clerkEnabled) return <p className="text-sm text-muted">{fallbackName} (dev sign-in)</p>;
  return (
    <div className="flex items-center gap-3">
      <UserButton />
      <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/app" afterCreateOrganizationUrl="/app" />
    </div>
  );
}
