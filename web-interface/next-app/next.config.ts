import path from "node:path";
import type { NextConfig } from "next";

const apiOrigin = process.env.WALNUT_PLATFORM_API_ORIGIN || "http://127.0.0.1:4173";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiOrigin}/api/:path*`,
      },
      {
        source: "/mcp",
        destination: `${apiOrigin}/mcp`,
      },
    ];
  },
};

export default nextConfig;
