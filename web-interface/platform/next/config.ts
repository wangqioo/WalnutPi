import type { NextConfig } from "next";

export const walnutNextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default walnutNextConfig;
