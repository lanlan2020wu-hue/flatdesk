import { ClerkProvider } from "@clerk/nextjs";
import { clerkEnabled } from "@/lib/auth-config";
import { clerkAppearance, clerkLocalization } from "@/lib/clerk-theme";

// Wraps only the routes that use Clerk's components (sign-in, sign-up, setup,
// the app), so marketing pages ship without Clerk's scripts. Without Clerk
// keys (local dev with DEV_AUTH) it renders the children as they are.
export default function AuthProvider({ children }: { children: React.ReactNode }) {
  if (!clerkEnabled) return children;
  return (
    <ClerkProvider appearance={clerkAppearance} localization={clerkLocalization}>
      {children}
    </ClerkProvider>
  );
}
