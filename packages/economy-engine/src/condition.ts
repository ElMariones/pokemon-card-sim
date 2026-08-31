/**
 * Card condition (DESIGN.md section 10).
 *
 * The five grades are defined in `@pcs/shared` because the database and the UI
 * both need them; what lives here is what they are *worth* and how a
 * pack-pulled card gets one.
 */
import { CONDITIONS, type Condition } from '@pcs/shared';
import { bp, type Bp } from './basis-points.js';
import { weightedPick, type Rng } from './rng.js';

/**
 * Price multipliers, in basis points.
 *
 * Anchored on the real single-card market, where Near Mint is the quoted price
 * and played copies trade at a discount that widens fast: LP is a mild haircut
 * that most buyers accept, while Damaged is close to bulk regardless of what
 * the card is. Strictly decreasing by design — `condition.test.ts` asserts it,
 * because a non-monotonic table would make "preserve your cards" meaningless.
 */
export const CONDITION_MULTIPLIER_BP: Record<Condition, Bp> = {
  near_mint: bp(10_000),
  lightly_played: bp(8_500),
  moderately_played: bp(6_800),
  heavily_played: bp(4_500),
  damaged: bp(2_500),
};

/** Best-to-worst. Index is a usable severity rank. */
export const CONDITION_ORDER: readonly Condition[] = CONDITIONS;

export const conditionRank = (c: Condition): number => CONDITION_ORDER.indexOf(c);

export const conditionMultiplier = (c: Condition): Bp => CONDITION_MULTIPLIER_BP[c];

/** True when `a` is in better shape than `b`. */
export const isBetterCondition = (a: Condition, b: Condition): boolean =>
  conditionRank(a) < conditionRank(b);

/**
 * Condition distribution for a card that just came out of a sealed pack.
 *
 * DESIGN.md section 10: pack-pulled cards default to Near Mint "but should
 * still have tiny simulated condition variance". Tiny is the operative word —
 * a factory-fresh card is never Damaged, and the off-centre / edge-wear
 * outcomes that do occur are what make grading a gamble rather than a
 * formality. These weights are game-design values, not measured print-quality
 * statistics.
 */
export const PACK_CONDITION_WEIGHTS: readonly { value: Condition; weight: number }[] = [
  { value: 'near_mint', weight: 900 },
  { value: 'lightly_played', weight: 85 },
  { value: 'moderately_played', weight: 14 },
  { value: 'heavily_played', weight: 1 },
  // Damaged is deliberately absent: a pack does not produce creased cards.
];

/** Roll the condition of a freshly opened card. RNG is injected, never global. */
export const rollPackCondition = (rng: Rng): Condition => weightedPick(rng, PACK_CONDITION_WEIGHTS);

/**
 * Condition of a card bought from the NPC market. Dealers stock what they
 * bought, so the spread of conditions is wider than a fresh pack — and a
 * cheaper listing being a played copy is a real decision for the player.
 */
export const MARKET_CONDITION_WEIGHTS: readonly { value: Condition; weight: number }[] = [
  { value: 'near_mint', weight: 620 },
  { value: 'lightly_played', weight: 240 },
  { value: 'moderately_played', weight: 100 },
  { value: 'heavily_played', weight: 30 },
  { value: 'damaged', weight: 10 },
];

export const rollMarketCondition = (rng: Rng): Condition =>
  weightedPick(rng, MARKET_CONDITION_WEIGHTS);
