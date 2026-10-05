import { RIVALS, rival } from "@/lib/compare";
import { FREE_TOOLS, freeTool } from "@/lib/free-tools";
import { ogImage } from "@/lib/og";
import { SELLING_POINTS, sellingPoint } from "@/lib/selling-points";

// Social cards for the feature and comparison pages, rendered at build time.
// (A page's own openGraph.images replaces a colocated opengraph-image file,
// so these are plain routes the pages name in their metadata.)
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return [
    ...SELLING_POINTS.map((p) => ({ kind: "features", slug: p.slug })),
    ...RIVALS.map((r) => ({ kind: "compare", slug: r.slug })),
    { kind: "free-tools", slug: "index" },
    ...FREE_TOOLS.map((t) => ({ kind: "free-tools", slug: t.slug })),
  ];
}

export async function GET(_req: Request, ctx: RouteContext<"/og/[kind]/[slug]">) {
  const { kind, slug } = await ctx.params;
  if (kind === "features") {
    const p = sellingPoint(slug);
    if (p) return ogImage({ eyebrow: p.name, title: p.headline });
  }
  if (kind === "compare") {
    const r = rival(slug);
    if (r) return ogImage({ eyebrow: "Compare", title: `Flatdesk vs ${r.title}` });
  }
  if (kind === "free-tools") {
    if (slug === "index") return ogImage({ eyebrow: "Free tools", title: "Free tools for customer support teams", footer: "Free · no signup · by Flatdesk" });
    const t = freeTool(slug);
    if (t) return ogImage({ eyebrow: "Free tool", title: t.name, footer: "Free · no signup · by Flatdesk" });
  }
  return new Response("Not found", { status: 404 });
}
