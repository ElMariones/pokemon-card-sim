import type { RarityTier } from './rarity.js';

/**
 * Exhaustive map of every rarity string pokemontcg.io currently publishes
 * (38 as of 2026-08-30, verified against GET /v2/rarities) onto our tiers.
 *
 * Two judgement calls worth knowing about, both made for pacing rather than
 * for market value:
 *
 *  - "Double Rare" and "Rare Holo V" are the ordinary ex/V cards that show up
 *    every few packs. They map to holo_rare, not ultra_rare, so the pack
 *    opening does not fire its biggest animation on a routine pull.
 *  - "Rare Holo Star" (the vintage gold stars) maps to secret_rare despite the
 *    word "Holo", because pulling one is a genuine event.
 *
 * Anything absent from this map normalizes to 'unknown' and is reported by
 * scripts/validate/validate-data.ts rather than silently guessed at.
 */
export const RARITY_STRING_TO_TIER: Record<string, RarityTier> = {
  // --- baseline ---
  Common: 'common',
  Uncommon: 'uncommon',
  Rare: 'rare',
  Promo: 'promo',

  // --- holo rare: the ordinary "good card" of its era ---
  'Rare Holo': 'holo_rare',
  'Double Rare': 'holo_rare',
  'Rare Holo V': 'holo_rare',
  'Rare BREAK': 'holo_rare',
  'Rare Prime': 'holo_rare',
  'Amazing Rare': 'holo_rare',
  'Radiant Rare': 'holo_rare',
  'Rare Shiny': 'holo_rare',
  'Shiny Rare': 'holo_rare',
  'Black White Rare': 'holo_rare',
  'Trainer Gallery Rare Holo': 'holo_rare',

  // --- ultra rare: a real hit ---
  'Ultra Rare': 'ultra_rare',
  'Rare Ultra': 'ultra_rare',
  'Rare Holo EX': 'ultra_rare',
  'Rare Holo GX': 'ultra_rare',
  'Rare Holo VMAX': 'ultra_rare',
  'Rare Holo VSTAR': 'ultra_rare',
  'Rare Holo LV.X': 'ultra_rare',
  'Illustration Rare': 'ultra_rare',
  'ACE SPEC Rare': 'ultra_rare',
  'Rare ACE': 'ultra_rare',
  'Rare Prism Star': 'ultra_rare',
  'Rare Shining': 'ultra_rare',
  'Rare Shiny GX': 'ultra_rare',
  'Shiny Ultra Rare': 'ultra_rare',
  LEGEND: 'ultra_rare',
  MEGA_ATTACK_RARE: 'ultra_rare',

  // --- secret rare: the chase ---
  'Rare Secret': 'secret_rare',
  'Rare Rainbow': 'secret_rare',
  'Hyper Rare': 'secret_rare',
  'Mega Hyper Rare': 'secret_rare',
  'Special Illustration Rare': 'secret_rare',
  'Rare Holo Star': 'secret_rare',
  'Classic Collection': 'secret_rare',
};

export interface NormalizeRarityInput {
  rarity?: string | null;
  supertype?: string | null;
  subtypes?: string[] | null;
}

/**
 * Basic Energy occupies its own pack slot and must never be treated as a
 * pullable Common, so it is detected structurally rather than by rarity text.
 */
export function normalizeRarity(card: NormalizeRarityInput): RarityTier {
  if (card.supertype === 'Energy' && card.subtypes?.includes('Basic')) return 'energy';
  if (!card.rarity) return 'unknown';
  return RARITY_STRING_TO_TIER[card.rarity] ?? 'unknown';
}
