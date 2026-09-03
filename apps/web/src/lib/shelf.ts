import { RARITY_TIERS, type RarityTier } from "@pcs/shared";

/**
 * The shelf's headline card: the most valuable pull a pack of a set allows.
 *
 * Declared here rather than beside either end of the wire, because both ends
 * need it — `/api/sets` builds it and `PackShelfCard` renders it — and a shape
 * written down twice is a shape that drifts. Neither side owns it.
 */
export interface ChaseCard {
  id: string;
  name: string;
  number: string;
  rarityTier: RarityTier;
  imageSmall: string | null;
  price: number;
}

const TIERS = new Set<string>(RARITY_TIERS);

/**
 * Narrow a rarity string from the database to a tier.
 *
 * `cards.rarity_tier` is normalized on import, so in practice every row is
 * already a `RarityTier` — but the column is free text, and the honest way to
 * hand it to code that switches on the union is to check rather than to cast.
 * Anything unrecognised becomes `unknown`, which every display map covers.
 */
export function toRarityTier(raw: string | null | undefined): RarityTier {
  return raw && TIERS.has(raw) ? (raw as RarityTier) : "unknown";
}
