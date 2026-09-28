import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Replies can carry up to 4 MB of attachments (Vercel's request limit is 4.5 MB).
    serverActions: { bodySizeLimit: "4.4mb" },
  },
};

export default nextConfig;
