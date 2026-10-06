import { headers } from "next/headers";
import { cache } from "react";
import { access } from "@/lib/billing";
import { orgByHelpSlug, verifiedDomain } from "@/lib/help";
import { pickLanguage } from "@/lib/help-i18n";

// The team behind a help center address, or null when there's none or the
// team's trial ended without a card (the help center goes dark with the app).
// The address is /help/<slug>, or the team's own domain (the proxy rewrites
// help.acme.com/x to /help/help.acme.com/x), where links start at "/".
export const helpCenter = cache(async (slug: string) => {
  const org = await orgByHelpSlug(slug);
  if (!org?.helpSlug || access(org).state === "locked") return null;
  const byDomain = slug.includes(".");
  const host = (await headers()).get("host")?.toLowerCase().replace(/:\d+$/, "");
  const base = byDomain && host === org.helpDomain ? "" : `/help/${byDomain ? org.helpDomain : org.helpSlug}`;
  const languages = [org.language, ...org.helpLanguages.filter((l) => l !== org.language)];
  return { id: org.id, name: org.name, helpSlug: org.helpSlug, supportEmail: org.supportEmail, widgetKey: org.widgetKey, base, languages, domain: verifiedDomain(org) };
});

export type HelpCenter = NonNullable<Awaited<ReturnType<typeof helpCenter>>>;

// The language this visit is in (see pickLanguage).
export async function visitLanguage(org: HelpCenter, asked: string | string[] | undefined) {
  const one = Array.isArray(asked) ? asked[0] : asked;
  return pickLanguage(org.languages, one, (await headers()).get("accept-language"));
}

// A link within the help center, keeping a language picked from the menu.
export function helpHref(org: HelpCenter, path: string, lang: string, params: Record<string, string> = {}) {
  const q = new URLSearchParams(params);
  if (org.languages.length > 1 && lang !== org.languages[0]) q.set("lang", lang);
  const qs = q.toString();
  return `${org.base}${path}${qs ? `?${qs}` : ""}` || "/";
}
