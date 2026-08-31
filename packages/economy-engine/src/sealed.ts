import { cents, type Cents } from '../../shared/src/index';
import { applyBp, bp, BP_ONE, clampBp, type Bp } from './basis-points';
import { randNormal, type Rng } from './rng';

/**
 * Sealed product (DESIGN.md section 14).
 *
 * The decision this system exists to create: open it, or hold it?
 *
 * Sealed value is deliberately NOT the sum of the cards inside. Real sealed
 * product trades at a premium over its expected contents, because scarcity
 * only ever increases — every box opened is one fewer box. So sealed value drifts
 * upward slowly while singles drift around their baseline, and the player
 * pays for that patience by giving up the cards now.
 */

export type ProductType =
  | 'booster_pack'
  | 'booster_bundle'
  | 'elite_trainer_box'
  | 'booster_box'
  | 'collection_box'
  | 'tin'
  | 'blister'
  | 'premium_collection';

export interface ProductShape {
  type: ProductType;
  label: string;
  packs: number;
  /** Premium over the raw value of the packs inside, in basis points. */
  sealedPremiumBp: Bp;
  /** Extras that carry no pack value but do carry sealed value. */
  accessories: string[];
}

/**
 * Standard configurations. Pack counts are the real ones; the premium is a
 * game value tuned so that holding is a genuine alternative to opening rather
 * than a strictly better or strictly worse choice.
 */
export const PRODUCT_SHAPES: readonly ProductShape[] = [
  {
    type: 'booster_bundle', label: 'Booster Bundle', packs: 6,
    sealedPremiumBp: bp(10_800), accessories: [],
  },
  {
    type: 'elite_trainer_box', label: 'Elite Trainer Box', packs: 9,
    sealedPremiumBp: bp(11_500), accessories: ['sleeves', 'dice', 'energy', 'dividers'],
  },
  {
    type: 'booster_box', label: 'Booster Box', packs: 36,
    sealedPremiumBp: bp(10_400), accessories: [],
  },
  {
    type: 'collection_box', label: 'Collection Box', packs: 4,
    sealedPremiumBp: bp(12_000), accessories: ['promo'],
  },
  {
    type: 'tin', label: 'Tin', packs: 3,
    sealedPremiumBp: bp(12_500), accessories: ['promo'],
  },
];

export const shapeFor = (type: ProductType): ProductShape | undefined =>
  PRODUCT_SHAPES.find((s) => s.type === type);

/**
 * What a sealed product costs, and what it is worth held.
 *
 * Both derive from the simulated pack price, so a set whose packs are
 * expensive has expensive boxes without any per-set configuration.
 */
export function sealedBaseValue(packPrice: Cents, shape: ProductShape): Cents {
  return applyBp(cents(packPrice * shape.packs), shape.sealedPremiumBp);
}

/**
 * Buying sealed costs slightly more than its base value — the retail spread.
 * Without this, buying and immediately reselling sealed would be free money.
 */
export const SEALED_RETAIL_MARKUP_BP = bp(10_600);

export function sealedRetailPrice(packPrice: Cents, shape: ProductShape): Cents {
  return applyBp(sealedBaseValue(packPrice, shape), SEALED_RETAIL_MARKUP_BP);
}

/** What a dealer pays for sealed. Narrower spread than singles: it is liquid. */
export const SEALED_BUYBACK_BP = bp(8_800);

export function sealedBuyOffer(currentValue: Cents): Cents {
  const offer = applyBp(currentValue, SEALED_BUYBACK_BP);
  return offer >= currentValue ? cents(currentValue - 1) : offer;
}

// ---------------------------------------------------------------------------
// Sealed price movement
// ---------------------------------------------------------------------------

/**
 * Sealed drifts differently from singles: a slow upward bias plus noise, with
 * no mean reversion to a fixed baseline. Supply of a printed set only shrinks.
 *
 * The bias is small — roughly 12% a year at the default — so holding is a real
 * strategy that takes real time, not a guaranteed win that beats opening.
 */
export const SEALED_DAILY_DRIFT_BP = 3;
export const SEALED_DAILY_VOLATILITY_BP = 55;
export const SEALED_MIN_BP = bp(4_000);
export const SEALED_MAX_BP = bp(120_000);

export function driftSealed(trendBp: Bp, rng: Rng, years = 0): Bp {
  // Older sealed appreciates faster: it is scarcer and more of it has been opened.
  const ageBonus = Math.min(years, 25) * 0.4;
  const drift = SEALED_DAILY_DRIFT_BP + ageBonus;
  const shock = randNormal(rng) * SEALED_DAILY_VOLATILITY_BP;
  return clampBp(bp(trendBp + drift + shock), SEALED_MIN_BP, SEALED_MAX_BP);
}

/** Years between a set's release and now, used for the age bonus. */
export function yearsSince(releaseDate: string, now = new Date()): number {
  const released = new Date(releaseDate).getTime();
  if (!Number.isFinite(released)) return 0;
  return Math.max(0, (now.getTime() - released) / (365.25 * 24 * 60 * 60 * 1000));
}
