import { ERAS, type Era } from '../../shared/src/index.js';

/**
 * Series string -> Era.
 *
 * The source catalogue (PokemonTCG/pokemon-tcg-data) publishes a free-text
 * `series` on every set. As of the 2026-08-30 snapshot it contains exactly 17
 * distinct values, all of which are mapped below. The map is deliberately
 * exhaustive over what the source *actually* contains rather than over what
 * the eras "should" be, so that a new series appearing upstream falls through
 * to 'other' and is reported by import-sets.ts instead of being guessed at.
 *
 * Three judgement calls:
 *
 *  - "Gym" (Gym Heroes / Gym Challenge, 2000) is folded into 'classic'. It is
 *    the same WOTC print era as Base/Jungle/Fossil and shares its pack shape.
 *  - "POP" (POP Series 1-9, 2004-2009) straddles the EX and Diamond & Pearl
 *    eras and consists entirely of league-distribution promo sets that were
 *    never sold as boosters. It maps to 'other' rather than being split.
 *  - "NP" (Nintendo Black Star Promos) and "Other" (Southern Islands,
 *    Legendary Collection, McDonald's, Futsal, Rumble...) are cross-era
 *    special products with no booster configuration, so they map to 'other'.
 *
 * 'other' therefore means "intentionally not an era", not "unrecognized".
 * `isKnownSeries` is what distinguishes the two.
 */
export const SERIES_TO_ERA: Record<string, Era> = {
  Base: 'classic',
  Gym: 'classic',
  Neo: 'neo',
  'E-Card': 'ecard',
  EX: 'ex',
  'Diamond & Pearl': 'dp',
  Platinum: 'platinum',
  'HeartGold & SoulSilver': 'hgss',
  'Black & White': 'bw',
  XY: 'xy',
  'Sun & Moon': 'sm',
  'Sword & Shield': 'swsh',
  'Scarlet & Violet': 'sv',
  'Mega Evolution': 'me',
  POP: 'other',
  NP: 'other',
  Other: 'other',
};

/** Case- and whitespace-insensitive lookup index over SERIES_TO_ERA. */
const INDEX: ReadonlyMap<string, Era> = new Map(
  Object.entries(SERIES_TO_ERA).map(([series, era]) => [normalizeKey(series), era]),
);

function normalizeKey(series: string): string {
  return series.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** True when the series is one we have deliberately classified. */
export function isKnownSeries(series: string | null | undefined): boolean {
  if (!series) return false;
  return INDEX.has(normalizeKey(series));
}

/**
 * Derive the release era from a set's `series` string.
 * Anything unmapped becomes 'other'; callers should surface those via
 * `isKnownSeries` so the map can be extended.
 */
export function deriveEra(series: string | null | undefined): Era {
  if (!series) return 'other';
  return INDEX.get(normalizeKey(series)) ?? 'other';
}

/** Chronological display order for eras, oldest first. */
export const ERA_ORDER: readonly Era[] = ERAS;

export const ERA_LABEL: Record<Era, string> = {
  classic: 'Classic (WOTC)',
  neo: 'Neo',
  ecard: 'e-Card',
  ex: 'EX',
  dp: 'Diamond & Pearl',
  platinum: 'Platinum',
  hgss: 'HeartGold & SoulSilver',
  bw: 'Black & White',
  xy: 'XY',
  sm: 'Sun & Moon',
  swsh: 'Sword & Shield',
  sv: 'Scarlet & Violet',
  me: 'Mega Evolution',
  other: 'Promos & Special Products',
};
