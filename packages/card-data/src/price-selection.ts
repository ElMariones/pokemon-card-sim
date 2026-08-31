import { dollarsToCents, type Cents, type Confidence } from '../../shared/src/index.js';

/**
 * Turning a pile of third-party price quotes into one baseline number.
 *
 * The rule from DESIGN.md section 5 that governs this file: never invent a
 * price. If no source covers a card the answer is `null` with confidence
 * 'unknown', and the market simulation has to cope with that. A plausible
 * made-up baseline would silently become "the price of this card" everywhere
 * in the game, and nothing downstream could tell it apart from a real one.
 */

/** One TCGplayer variant block, e.g. `prices.holofoil`. */
export interface TcgPlayerVariantPrices {
  low?: number | null;
  mid?: number | null;
  high?: number | null;
  market?: number | null;
  directLow?: number | null;
}

/** The subset of a pokemontcg.io card object that carries pricing. */
export interface PriceSourceCard {
  tcgplayer?: {
    url?: string | null;
    updatedAt?: string | null;
    prices?: Record<string, TcgPlayerVariantPrices | null | undefined> | null;
  } | null;
  cardmarket?: {
    url?: string | null;
    updatedAt?: string | null;
    prices?: { averageSellPrice?: number | null; [k: string]: number | null | undefined } | null;
  } | null;
}

export type PriceBasis =
  | 'tcgplayer_market'
  | 'tcgplayer_mid'
  | 'cardmarket_average_sell'
  | 'none';

export interface PriceSelection {
  /** Integer cents, or null when no source covers the card. */
  price: Cents | null;
  confidence: Confidence;
  basis: PriceBasis;
  /** Which TCGplayer variant the figure came from, when applicable. */
  variant: string | null;
}

/**
 * Which printing counts as "the" card when several are quoted.
 *
 * A 2023 set quotes `normal` and `reverseHolofoil`; a 1999 set quotes
 * `1stEditionHolofoil` and `unlimitedHolofoil`. We want the ordinary,
 * most-obtainable printing, because that is what a player pulls from a pack.
 * Variants outside this list are still considered, after the listed ones, in
 * whatever order the source object presents them.
 */
export const VARIANT_PREFERENCE: readonly string[] = [
  'normal',
  'holofoil',
  'reverseHolofoil',
  'unlimited',
  'unlimitedHolofoil',
  '1stEdition',
  '1stEditionNormal',
  '1stEditionHolofoil',
];

/**
 * Both price sources use 0.0 as "no data" rather than omitting the field
 * (Cardmarket's `germanProLow: 0.0` on a card that has never sold in Germany,
 * for example), so zero has to be rejected alongside null and NaN.
 */
function usable(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/** TCGplayer variants in preference order, listed ones first. */
function orderedVariants(prices: Record<string, unknown>): string[] {
  const present = Object.keys(prices);
  const preferred = VARIANT_PREFERENCE.filter((v) => present.includes(v));
  const rest = present.filter((v) => !VARIANT_PREFERENCE.includes(v));
  return [...preferred, ...rest];
}

const NO_PRICE: PriceSelection = {
  price: null,
  confidence: 'unknown',
  basis: 'none',
  variant: null,
};

/**
 * Pick a baseline price for one card.
 *
 * Order of preference, as specified in the import brief:
 *   1. `tcgplayer.prices.<variant>.market` — an actual transacted price.
 *   2. `tcgplayer.prices.<variant>.mid`    — midpoint of live listings.
 *   3. `cardmarket.prices.averageSellPrice` — the European market.
 *
 * A real market figure for *any* variant beats a mid figure for the preferred
 * variant: "what it sold for" is better evidence than "what it is listed at",
 * regardless of printing.
 */
export function selectBasePrice(card: PriceSourceCard | null | undefined): PriceSelection {
  if (!card) return NO_PRICE;

  const tcg = card.tcgplayer?.prices;
  if (tcg) {
    const variants = orderedVariants(tcg);

    for (const variant of variants) {
      const market = tcg[variant]?.market;
      if (usable(market)) {
        return {
          price: dollarsToCents(market),
          confidence: 'documented_community_data',
          basis: 'tcgplayer_market',
          variant,
        };
      }
    }

    for (const variant of variants) {
      const mid = tcg[variant]?.mid;
      if (usable(mid)) {
        return {
          price: dollarsToCents(mid),
          confidence: 'documented_community_data',
          basis: 'tcgplayer_mid',
          variant,
        };
      }
    }
  }

  // Cardmarket quotes EUR, not USD. We deliberately do not convert: the
  // simulator has a single nominal currency, this is a last-resort fallback
  // for cards TCGplayer does not cover at all, and a hardcoded FX rate would
  // be a second invented number layered on top of a substituted one.
  const avgSell = card.cardmarket?.prices?.averageSellPrice;
  if (usable(avgSell)) {
    return {
      price: dollarsToCents(avgSell),
      confidence: 'documented_community_data',
      basis: 'cardmarket_average_sell',
      variant: null,
    };
  }

  return NO_PRICE;
}
