/**
 * Rarity taxonomy.
 *
 * Source data (pokemontcg.io) uses ~40 free-text rarity strings that changed
 * meaning across eras: "Rare Holo VMAX", "Illustration Rare", "Radiant Rare",
 * plain "Rare" in 1999 vs 2024. Gameplay must not branch on those strings.
 *
 * We normalize every source string to a RarityTier. The tier drives pull
 * tables, reveal animation profiles and price priors; the original string is
 * preserved on the card for display and for re-normalizing later if we get
 * the mapping wrong.
 */
export const RARITY_TIERS = [
  'energy',
  'common',
  'uncommon',
  'rare',
  'holo_rare',
  'ultra_rare',
  'secret_rare',
  'promo',
  'unknown',
] as const;

export type RarityTier = (typeof RARITY_TIERS)[number];

/** Ordering for sorting and for deciding which pull in a pack is "the hit". */
export const RARITY_RANK: Record<RarityTier, number> = {
  energy: 0,
  common: 1,
  uncommon: 2,
  rare: 3,
  holo_rare: 4,
  ultra_rare: 5,
  secret_rare: 6,
  promo: 3,
  unknown: 0,
};

/**
 * How dramatic the reveal should be. Data-driven per design doc section 31 so
 * that adding a rarity does not mean editing animation code.
 */
export const REVEAL_PROFILE: Record<RarityTier, 'quick' | 'standard' | 'shine' | 'spectacle'> = {
  energy: 'quick',
  common: 'quick',
  uncommon: 'quick',
  rare: 'standard',
  holo_rare: 'shine',
  ultra_rare: 'spectacle',
  secret_rare: 'spectacle',
  promo: 'standard',
  unknown: 'quick',
};

/** A pull at or above this tier is worth interrupting the player for. */
export const HIT_THRESHOLD = RARITY_RANK.holo_rare;

export const isHit = (tier: RarityTier): boolean => RARITY_RANK[tier] >= HIT_THRESHOLD;
