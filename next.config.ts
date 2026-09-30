import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The chat widget script is embedded on customers' sites; let browsers and
  // the CDN reuse it for a few minutes instead of revalidating every page view.
  async headers() {
    return [{ source: "/widget.js", headers: [{ key: "Cache-Control", value: "public, max-age=300, stale-while-revalidate=86400" }] }];
  },
  // AI macros were called "macros that write themselves" before 2026-09-30.
  async redirects() {
    return [
      { source: "/features/self-writing-macros", destination: "/features/ai-macros", permanent: true },
      { source: "/og/features/self-writing-macros", destination: "/og/features/ai-macros", permanent: true },
    ];
  },
  experimental: {
    // Replies can carry up to 4 MB of attachments (Vercel's request limit is 4.5 MB).
    serverActions: { bodySizeLimit: "4.4mb" },
  },
};

export default nextConfig;
