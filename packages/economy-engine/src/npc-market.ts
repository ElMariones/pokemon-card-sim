import { cents, type Cents, type RarityTier } from '@pcs/shared';
import { applyBp, bp, bpBetween, clampCents, type Bp } from './basis-points';
import type { Rng } from './rng';

export type DemandBand = 'quiet' | 'some_interest' | 'drawing_attention' | 'likely_to_move';
export type OfferRisk = 'comfortable' | 'pushing_it' | 'risky' | 'insulting';

export interface OtherBuyerInput {
  askPrice: Cents;
  marketValue: Cents;
  rarityTier: RarityTier;
  graded: boolean;
  trafficBp: Bp;
  rng: Rng;
}

const CHASE = new Set<RarityTier>(['ultra_rare', 'secret_rare']);

/**
 * Pick a persisted delay until another collector buys the listing.
 * The broad bands are intentional: the UI reports interest, never a countdown.
 */
export function otherBuyerDelaySeconds(input: OtherBuyerInput): number {
  const ratioBp = bpBetween(input.marketValue, input.askPrice);
  const hot = CHASE.has(input.rarityTier) && ratioBp <= 11_500;
  const specialist = input.marketValue >= 50_000 || ratioBp > 12_000;

  let min: number;
  let max: number;
  if (hot) [min, max] = [30 * 60, 3 * 60 * 60];
  else if (specialist) [min, max] = [5 * 60 * 60, 18 * 60 * 60];
  else [min, max] = [2 * 60 * 60, 8 * 60 * 60];

  const gradeFactorBp = input.graded ? 9_000 : 10_000;
  const sampled = min + Math.floor(input.rng() * (max - min + 1));
  const trafficAdjusted = Math.round((sampled * 10_000) / Math.max(1, input.trafficBp));
  return Math.max(15 * 60, Math.round((trafficAdjusted * gradeFactorBp) / 10_000));
}

export function demandBandForDelay(seconds: number): DemandBand {
  if (seconds <= 3 * 60 * 60) return 'likely_to_move';
  if (seconds <= 6 * 60 * 60) return 'drawing_attention';
  if (seconds <= 12 * 60 * 60) return 'some_interest';
  return 'quiet';
}

export interface StockPriceInput {
  marketValue: Cents;
  markupBp: Bp;
  floorBp: Bp;
}

export function priceNpcStock(input: StockPriceInput): { askPrice: Cents; sellerFloor: Cents } {
  if (input.marketValue <= 0) throw new RangeError('NPC stock needs a positive market value');
  const askPrice = applyBp(input.marketValue, input.markupBp);
  const sellerFloor = applyBp(input.marketValue, input.floorBp);
  return { askPrice, sellerFloor: sellerFloor > askPrice ? askPrice : sellerFloor };
}

/** Wanted inventory is useful but remains a liquidity haircut, except exact wishes. */
export function tradeCredit(value: Cents, dealerCreditBp: Bp, exactWishlist: boolean): Cents {
  if (value <= 0) return cents(0);
  return exactWishlist ? value : applyBp(value, dealerCreditBp);
}

export function offerRisk(totalOffer: Cents, counterPrice: Cents, anger: number): OfferRisk {
  if (counterPrice <= 0) return 'comfortable';
  const ratio = totalOffer / counterPrice;
  if (ratio >= 0.94 && anger < 70) return 'comfortable';
  if (ratio >= 0.84 && anger < 80) return 'pushing_it';
  if (ratio >= 0.6 && anger < 92) return 'risky';
  return 'insulting';
}

export interface NegotiationInput {
  totalOffer: Cents;
  counterPrice: Cents;
  sellerFloor: Cents;
  anger: number;
  attempts: number;
  lastOffer: Cents | null;
  temperamentBase: number;
  repetitionPenalty: number;
}

export type NegotiationResult =
  | { accepted: true; acceptedTotal: Cents; anger: number; counterPrice: Cents }
  | { accepted: false; walked: boolean; anger: number; counterPrice: Cents; angerDelta: number };

/** Resolve one offer. Repeating an input is stateful, not another random roll. */
export function resolveNpcOffer(input: NegotiationInput): NegotiationResult {
  const totalOffer = clampCents(input.totalOffer, cents(1), input.counterPrice);
  if (totalOffer >= input.sellerFloor) {
    return { accepted: true, acceptedTotal: totalOffer, anger: input.anger, counterPrice: totalOffer };
  }

  const shortfallBp = Math.max(0, Math.round(((input.counterPrice - totalOffer) * 10_000) / input.counterPrice));
  const repeated = input.lastOffer !== null && totalOffer <= input.lastOffer
    ? input.repetitionPenalty
    : 0;
  const insulting = totalOffer * 10 < input.counterPrice * 6 ? 25 : 0;
  const angerDelta = Math.max(1, Math.round(
    input.temperamentBase + shortfallBp / 180 + repeated + insulting,
  ));
  const anger = Math.min(100, input.anger + angerDelta);

  // The seller gives up 35% of the gap, but never moves through their floor.
  const concession = Math.max(1, Math.round((input.counterPrice - totalOffer) * 0.35));
  const counterPrice = cents(Math.max(input.sellerFloor, input.counterPrice - concession));
  return { accepted: false, walked: anger >= 100, anger, counterPrice, angerDelta };
}

export const NPC_MARKUP_MIN_BP = bp(10_300);
export const NPC_MARKUP_MAX_BP = bp(13_200);
export const NPC_FLOOR_MIN_BP = bp(8_600);
export const NPC_FLOOR_MAX_BP = bp(10_100);
