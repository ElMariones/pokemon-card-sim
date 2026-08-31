import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Card art is hotlinked from the pokemontcg.io CDN through the
  // CardImageAsset indirection (CLAUDE.md, "Data sources").
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.pokemontcg.io", pathname: "/**" },
    ],
  },
  // The workspace packages ship raw TypeScript from src/, so Next has to
  // compile them rather than treat them as prebuilt node_modules.
  transpilePackages: ["@pcs/shared"],
};

export default nextConfig;
