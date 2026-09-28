import { RIVALS, rival } from "@/lib/compare";
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
  return new Response("Not found", { status: 404 });
}
