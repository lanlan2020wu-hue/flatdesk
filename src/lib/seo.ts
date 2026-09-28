// Page metadata and schema.org data for the public site. Every page sets a
// canonical URL so preview and old domains never compete with the real one.

import type { Metadata } from "next";
import type { QA } from "@/lib/selling-points";
import { PLAN } from "@/lib/pricing";
import { SITE } from "@/lib/site";

export const DESCRIPTION = `Flatdesk is a help desk for teams of 5–20 agents: $${PLAN.seatPrice} per agent per month with ${PLAN.includedPerAgent} AI resolutions per agent included and capped, itemized AI receipts, macros that write themselves, and lossless import.`;

// A page's openGraph replaces the layout's, image included, so every page
// names its card: the site-wide one, or its own from /og/<kind>/<slug>.
export function pageMeta({ title, description, path, image = "/opengraph-image" }: { title: string; description: string; path: string; image?: string }): Metadata {
  const IMAGE = { url: image, width: 1200, height: 630, alt: title };
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: path, siteName: "Flatdesk", type: "website", images: [IMAGE] },
    twitter: { card: "summary_large_image", title, description, images: [IMAGE] },
  };
}

type Json = Record<string, unknown>;

export const ORG_ID = `${SITE.url}/#organization`;

export function organization(): Json {
  return {
    "@type": "Organization",
    "@id": ORG_ID,
    name: "Flatdesk",
    url: SITE.url,
    logo: `${SITE.url}/icon.svg`,
    email: SITE.contactEmail,
  };
}

export function website(): Json {
  return { "@type": "WebSite", "@id": `${SITE.url}/#website`, name: "Flatdesk", url: SITE.url, publisher: { "@id": ORG_ID } };
}

export function software(): Json {
  return {
    "@type": "SoftwareApplication",
    "@id": `${SITE.url}/#software`,
    name: "Flatdesk",
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Help desk software",
    operatingSystem: "Web",
    url: SITE.url,
    description: DESCRIPTION,
    publisher: { "@id": ORG_ID },
    offers: {
      "@type": "Offer",
      price: PLAN.seatPrice,
      priceCurrency: "USD",
      url: `${SITE.url}/pricing`,
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: PLAN.seatPrice,
        priceCurrency: "USD",
        unitText: "per agent per month",
        billingDuration: "P1M",
      },
    },
  };
}

export function faqPage(faq: QA[]): Json {
  return {
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}

export function breadcrumbs(items: { name: string; path: string }[]): Json {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: `${SITE.url}${it.path}` })),
  };
}
