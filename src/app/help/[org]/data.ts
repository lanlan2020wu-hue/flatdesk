import { cache } from "react";
import { access } from "@/lib/billing";
import { orgByHelpSlug } from "@/lib/help";

// The team behind a help center address, or null when there's none or the
// team's trial ended without a card (the help center goes dark with the app).
export const helpCenter = cache(async (slug: string) => {
  const org = await orgByHelpSlug(slug);
  if (!org?.helpSlug || access(org).state === "locked") return null;
  return { id: org.id, name: org.name, helpSlug: org.helpSlug, supportEmail: org.supportEmail, widgetKey: org.widgetKey };
});
