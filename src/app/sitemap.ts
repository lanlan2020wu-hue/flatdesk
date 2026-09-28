import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

const PAGES = ["", "/pricing", "/calculator", "/ai-billing-changes-2026", "/sign-up", "/terms", "/privacy"];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((p) => ({ url: `${SITE.url}${p}`, changeFrequency: "weekly", priority: p === "" ? 1 : 0.6 }));
}
