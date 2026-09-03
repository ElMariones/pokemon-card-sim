import type { NextConfig } from "next";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

// Next runs from apps/web in this workspace, while local secrets deliberately
// live at the repository root. Load that ignored file before validating the
// database selected by the dev script.
loadEnvConfig(
  path.resolve(process.cwd(), "../.."),
  process.env.NODE_ENV === "development",
  console,
  true,
);

const CONFIRMED_SUPABASE_REF = "ckrybfpctqqrijrvmnhb";

if (process.env.DATABASE_MODE === "supabase") {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "npm run dev requires DATABASE_URL for the confirmed Supabase project. " +
      "Add it to the repository-root .env.local, or run npm run dev:mock.",
    );
  }

  const parsed = new URL(databaseUrl);
  const direct = parsed.hostname === `db.${CONFIRMED_SUPABASE_REF}.supabase.co`;
  const pooled = parsed.hostname.endsWith(".pooler.supabase.com") &&
    decodeURIComponent(parsed.username).endsWith(`.${CONFIRMED_SUPABASE_REF}`);
  if (!direct && !pooled) {
    throw new Error(
      `DATABASE_URL does not point to the confirmed Supabase project ${CONFIRMED_SUPABASE_REF}.`,
    );
  }
}

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
  transpilePackages: [
    "@pcs/shared",
    "@pcs/db",
    "@pcs/card-data",
    "@pcs/pack-engine",
    "@pcs/economy-engine",
    "@pcs/minigame-engine",
  ],
};

export default nextConfig;
