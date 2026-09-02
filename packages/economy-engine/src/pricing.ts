import { cents, scaleCents, type Cents } from '../../shared/src/index';
import type { Condition, Confidence, RarityTier } from '../../shared/src/index';
import { BP_ONE, applyBp, clampBp, composeBp, bp, type Bp } from './basis-points';
import { conditionMultiplier } from './condition';

/**
 * The card market (DESIGN.md section 12).
 *
 * price = base × demand × rarity × trend × supply × condition × grade
 *
 * Every factor is an integer basis-point value (10000 = 1.0×) so the chain
 * composes exactly and cannot drift the way repeated float multiplication
 * would.
 */

export interface PriceFactors {
  demand?: Bp;
  rarity?: Bp;
  trend?: Bp;
  supply?: Bp;
  grade?: Bp;
  condition?: Condition;
}

/** Rarity's standing effect on price, independent of what the market is doing. */
export const RARITY_PRICE_BP: Record<RarityTier, Bp> = {
  energy: bp(9_000),
  common: bp(9_500),
  uncommon: bp(10_000),
  rare: bp(10_500),
  holo_rare: bp(11_000),
  ultra_rare: bp(11_500),
  secret_rare: bp(12_000),
  promo: bp(10_500),
  unknown: BP_ONE,
};

/** Nothing may fall below 1% or rise above 25× its baseline. */
export const MIN_PRICE_BP = bp(100);
export const MAX_PRICE_BP = bp(250_000);

/** A card is never worth less than this, so bulk still has a floor. */
export const PRICE_FLOOR: Cents = cents(5);

export function computePrice(base: Cents, f: PriceFactors = {}): Cents {
  const combined = composeBp(
    f.demand ?? BP_ONE,
    f.rarity ?? BP_ONE,
    f.trend ?? BP_ONE,
    f.supply ?? BP_ONE,
    f.grade ?? BP_ONE,
    f.condition ? conditionMultiplier(f.condition) : BP_ONE,
  );
  const clamped = clampBp(combined, MIN_PRICE_BP, MAX_PRICE_BP);
  const price = applyBp(base, clamped);
  return price < PRICE_FLOOR ? PRICE_FLOOR : price;
}

// ───────────────────────────────────────────────────────────────────────────
// The dealer
// ───────────────────────────────────────────────────────────────────────────

/**
 * The NPC dealer's buy/sell spread (DESIGN.md section 13).
 *
 * This spread is the game's primary money sink and the main reason a player
 * cannot churn buy-and-sell for free profit. It widens for cheap cards,
 * because in the real hobby nobody pays near market for bulk.
 */
export const DEALER_SPREAD_BP = {
  bulk: bp(3_000),     // under $1  -> dealer pays 30%
  low: bp(5_000),      // under $10 -> 50%
  mid: bp(6_500),      // under $50 -> 65%
  high: bp(7_500),     // under $250 -> 75%
  premium: bp(8_500),  // above     -> 85%
} as const;

export function dealerSpreadBp(marketValue: Cents): Bp {
  if (marketValue < 100) return DEALER_SPREAD_BP.bulk;
  if (marketValue < 1_000) return DEALER_SPREAD_BP.low;
  if (marketValue < 5_000) return DEALER_SPREAD_BP.mid;
  if (marketValue < 25_000) return DEALER_SPREAD_BP.high;
  return DEALER_SPREAD_BP.premium;
}

/** What the dealer pays the player. Always strictly below market value. */
export function dealerBuyOffer(marketValue: Cents): Cents {
  if (marketValue <= 0) return cents(0);
  const offer = applyBp(marketValue, dealerSpreadBp(marketValue));
  // Rounding must never let the offer meet or exceed market.
  const capped = offer >= marketValue ? cents(marketValue - 1) : offer;
  return capped < 1 ? cents(1) : capped;
}

/** What the player pays the dealer for a single. Always above market. */
export const DEALER_SELL_MARKUP_BP = bp(11_500);

export function dealerAskPrice(marketValue: Cents): Cents {
  const ask = applyBp(marketValue, DEALER_SELL_MARKUP_BP);
  return ask <= marketValue ? cents(marketValue + 1) : ask;
}

// ───────────────────────────────────────────────────────────────────────────
// Pack pricing
// ───────────────────────────────────────────────────────────────────────────

/**
 * What a pack costs to buy.
 *
 * This is deliberately NOT the real-world MSRP. Simulating 100,000 Base Set
 * packs against real 2026 market prices gives average contents worth ~$63,
 * because a 1999 Charizard is now worth thousands. Selling those packs at
 * their historical $3.99 would be an infinite money glitch, and DESIGN.md
 * section 30 is explicit that opening must be exciting but not always
 * profitable.
 *
 * So the price is derived from the simulated expected value plus a house
 * edge. The player's edge comes from knowing what to keep, grade or hold —
 * not from the pack itself being underpriced.
 */
export const PACK_HOUSE_EDGE_BP = bp(11_500); // packs cost 115% of expected value

/** Packs never cost less than this, so cheap sets still sink money. */
export const MIN_PACK_PRICE: Cents = cents(199);

export function derivePackPrice(expectedValue: Cents): Cents {
  const priced = applyBp(expectedValue, PACK_HOUSE_EDGE_BP);
  return priced < MIN_PACK_PRICE ? MIN_PACK_PRICE : priced;
}

/**
 * Where a pack's price came from, best evidence first.
 *
 * The derivation above is now the last resort rather than the rule. A pack is
 * a real product with a real price: a 1999 Base Set pack trades near $850
 * because the sealed pack is the collectible, and no amount of simulating its
 * contents will produce that number. Pricing from contents also made every
 * pack return the same ~85%, which left nothing for a player to know.
 */
export type PackPriceSource = 'curated' | 'market' | 'inherited' | 'era_median' | 'simulated';

export interface PackPriceInputs {
  /** Hand-reviewed sealed snapshot, multi-market and cited. */
  curated?: Cents | null;
  /** Today's quoted price for the set's booster pack. */
  market?: Cents | null;
  /**
   * The parent set's pack price, for a subset that has no booster of its own.
   * A Trainer Gallery card comes out of the parent set's pack.
   */
  inherited?: Cents | null;
  /** Median real pack price of the set's era, for sets never sold as boosters. */
  eraMedian?: Cents | null;
  /** Simulated contents value, used only when nothing real is known. */
  simulatedEv?: Cents | null;
}

export interface PackPriceResolution {
  price: Cents;
  source: PackPriceSource;
  confidence: Confidence;
}

const quoted = (c: Cents | null | undefined): c is Cents =>
  typeof c === 'number' && Number.isFinite(c) && c > 0;

/**
 * Resolve one pack's price.
 *
 * The minimum-price floor applies only to the estimated tiers. A real quote
 * below it is reported as it stands: raising a price we actually observed
 * would make the number a game value wearing a market label.
 */
export function resolvePackPrice(inputs: PackPriceInputs): PackPriceResolution | null {
  if (quoted(inputs.curated)) {
    return { price: inputs.curated, source: 'curated', confidence: 'documented_community_data' };
  }
  if (quoted(inputs.market)) {
    return { price: inputs.market, source: 'market', confidence: 'documented_community_data' };
  }
  const floored = (c: Cents): Cents => (c < MIN_PACK_PRICE ? MIN_PACK_PRICE : c);
  if (quoted(inputs.inherited)) {
    return { price: floored(inputs.inherited), source: 'inherited', confidence: 'estimated' };
  }
  if (quoted(inputs.eraMedian)) {
    return { price: floored(inputs.eraMedian), source: 'era_median', confidence: 'estimated' };
  }
  if (quoted(inputs.simulatedEv)) {
    return { price: derivePackPrice(inputs.simulatedEv), source: 'simulated', confidence: 'estimated' };
  }
  return null;
}

/** Median of a price sample, in cents. Even samples take the midpoint. */
export function medianCents(values: readonly Cents[]): Cents | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return cents(sorted[mid]!);
  return cents(Math.round((sorted[mid - 1]! + sorted[mid]!) / 2));
}

/**
 * Expected value of one pack, given per-slot rarity odds and the average
 * value of each rarity in that set. Used by the pack-price derivation and by
 * the balance tests.
 */
export function expectedPackValue(
  slotOdds: readonly Partial<Record<RarityTier, number>>[],
  averageValueByRarity: Partial<Record<RarityTier, Cents>>,
): Cents {
  let total = 0;
  for (const slot of slotOdds) {
    const weightTotal = Object.values(slot).reduce((a, b) => a + (b ?? 0), 0);
    if (weightTotal <= 0) continue;
    for (const [tier, weight] of Object.entries(slot)) {
      const avg = averageValueByRarity[tier as RarityTier] ?? 0;
      total += ((weight ?? 0) / weightTotal) * avg;
    }
  }
  return cents(total);
}
