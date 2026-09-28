import type { MetadataRoute } from "next";
import { RIVALS } from "@/lib/compare";
import { SELLING_POINTS } from "@/lib/selling-points";
import { SITE } from "@/lib/site";

const PAGES = [
  "",
  "/pricing",
  "/calculator",
  "/features",
  ...SELLING_POINTS.map((p) => `/features/${p.slug}`),
  "/compare",
  ...RIVALS.map((r) => `/compare/${r.slug}`),
  "/faq",
  "/ai-billing-changes-2026",
  "/terms",
  "/privacy",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((p) => ({ url: `${SITE.url}${p}`, changeFrequency: "weekly", priority: p === "" ? 1 : 0.6 }));
}
