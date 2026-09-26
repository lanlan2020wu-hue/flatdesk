import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { clerkEnabled } from "@/lib/auth-config";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["500", "600"],
  style: ["normal", "italic"],
});

// Keeps Clerk's sign-in, team and account screens in Flatdesk's colors and type.
const clerkAppearance = {
  variables: {
    colorPrimary: "#17624b",
    fontFamily: "var(--font-plex-sans), system-ui, sans-serif",
    borderRadius: "0.625rem",
  },
};

export const metadata: Metadata = {
  title: {
    default: "Flatdesk: the help desk with one flat price",
    template: "%s · Flatdesk",
  },
  description:
    "$49 per agent per month. AI resolutions included and capped, so your support bill is the same every month.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans text-[15px] leading-relaxed">
        {clerkEnabled ? <ClerkProvider appearance={clerkAppearance}>{children}</ClerkProvider> : children}
      </body>
    </html>
  );
}
