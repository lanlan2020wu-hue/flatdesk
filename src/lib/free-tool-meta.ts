import { freeToolPath, toolBySlug } from "@/lib/free-tools";
import { pageMeta } from "@/lib/seo";
import { SITE } from "@/lib/site";

// Metadata and schema.org data for one free tool page, with its own social card.
export function freeToolMeta(slug: string) {
  const t = toolBySlug(slug);
  return pageMeta({ title: t.title, description: t.description, path: freeToolPath(slug), image: `/og/free-tools/${slug}` });
}

export function webApplication(slug: string): Record<string, unknown> {
  const t = toolBySlug(slug);
  return {
    "@type": "WebApplication",
    name: t.name,
    url: `${SITE.url}${freeToolPath(slug)}`,
    description: t.description,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: 0, priceCurrency: "USD" },
    publisher: { "@id": `${SITE.url}/#organization` },
  };
}
