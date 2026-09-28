import type { ClerkProvider } from "@clerk/nextjs";

type ClerkProps = React.ComponentProps<typeof ClerkProvider>;

// Keeps Clerk's sign-in, team and account screens in Flatdesk's colors and type.
// Our own logo sits above the form (AuthShell), so Clerk's is turned off.
export const clerkAppearance: ClerkProps["appearance"] = {
  variables: {
    colorPrimary: "#17624b",
    fontFamily: "var(--font-plex-sans), system-ui, sans-serif",
    borderRadius: "0.625rem",
  },
  options: {
    logoPlacement: "none",
    logoLinkUrl: "/",
    termsPageUrl: "/terms",
    privacyPageUrl: "/privacy",
  },
};

// Clerk's default copy fills in {{applicationName}} from the Clerk dashboard,
// which read "Clerk" on the sign-in screen. Naming Flatdesk here keeps every
// screen right whatever the dashboard says. Strings not listed keep Clerk's
// English defaults.
const toFlatdesk = "to continue to Flatdesk";

export const clerkLocalization: ClerkProps["localization"] = {
  signIn: {
    start: {
      title: "Sign in to Flatdesk",
      titleCombined: "Continue to Flatdesk",
      subtitle: "Welcome back. Sign in to get to your inbox.",
      subtitleCombined: "Welcome back. Sign in to get to your inbox.",
      alternativePhoneCodeProvider: { title: "Sign in to Flatdesk with {{provider}}" },
    },
    emailCode: { subtitle: toFlatdesk },
    emailCodeMfa: { subtitle: toFlatdesk },
    emailLink: { subtitle: toFlatdesk },
    emailLinkMfa: { subtitle: toFlatdesk },
    phoneCode: { subtitle: toFlatdesk },
    alternativePhoneCodeProvider: { subtitle: toFlatdesk },
    ssoBypass: { code: { subtitle: toFlatdesk } },
  },
  signUp: {
    start: {
      title: "Create your Flatdesk account",
      titleCombined: "Create your Flatdesk account",
      subtitle: "Your team's help desk, ready in a few minutes.",
      subtitleCombined: "Your team's help desk, ready in a few minutes.",
      alternativePhoneCodeProvider: { title: "Sign up to Flatdesk with {{provider}}" },
    },
    emailLink: { subtitle: toFlatdesk },
  },
  organizationList: { subtitle: toFlatdesk },
};
