import { describe, expect, it } from 'vitest';
import { cents } from '../../shared/src/index';
import { bp } from './basis-points';
import { mulberry32 } from './rng';
import {
  demandBandForDelay,
  offerRisk,
  otherBuyerDelaySeconds,
  priceNpcStock,
  resolveNpcOffer,
  tradeCredit,
} from './npc-market';

describe('NPC stock economy', () => {
  it('prices stock and its floor in integer cents', () => {
    const priced = priceNpcStock({ marketValue: cents(12_345), markupBp: bp(11_700), floorBp: bp(9_200) });
    expect(priced).toEqual({ askPrice: 14_444, sellerFloor: 11_357 });
    expect(Number.isInteger(priced.askPrice)).toBe(true);
  });

  it('persists deterministic buyer timing inside the intended bands', () => {
    const input = {
      askPrice: cents(11_000), marketValue: cents(10_000), rarityTier: 'secret_rare' as const,
      graded: false, trafficBp: bp(10_000), rng: mulberry32(42),
    };
    const a = otherBuyerDelaySeconds(input);
    const b = otherBuyerDelaySeconds({ ...input, rng: mulberry32(42) });
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(30 * 60);
    expect(a).toBeLessThanOrEqual(3 * 60 * 60);
  });

  it('makes high-traffic dealers move the same stock faster', () => {
    const base = {
      askPrice: cents(12_500), marketValue: cents(10_000), rarityTier: 'rare' as const,
      graded: false,
    };
    const slow = otherBuyerDelaySeconds({ ...base, trafficBp: bp(8_000), rng: mulberry32(7) });
    const fast = otherBuyerDelaySeconds({ ...base, trafficBp: bp(12_000), rng: mulberry32(7) });
    expect(fast).toBeLessThan(slow);
    expect(demandBandForDelay(fast)).not.toBe('quiet');
  });

  it('values exact wishlist cards at full value and other wants at dealer credit', () => {
    expect(tradeCredit(cents(15_000), bp(8_500), false)).toBe(12_750);
    expect(tradeCredit(cents(15_000), bp(8_500), true)).toBe(15_000);
  });
});

describe('NPC negotiation', () => {
  const base = {
    counterPrice: cents(50_000), sellerFloor: cents(44_000), anger: 0, attempts: 0,
    lastOffer: null, temperamentBase: 5, repetitionPenalty: 9,
  };

  it('accepts an offer at the fixed seller floor', () => {
    expect(resolveNpcOffer({ ...base, totalOffer: cents(44_000) })).toMatchObject({ accepted: true, acceptedTotal: 44_000 });
  });

  it('makes insulting offers anger the seller faster than fair misses', () => {
    const fair = resolveNpcOffer({ ...base, totalOffer: cents(43_500) });
    const insult = resolveNpcOffer({ ...base, totalOffer: cents(10_000) });
    expect(fair.accepted).toBe(false);
    expect(insult.accepted).toBe(false);
    if (!fair.accepted && !insult.accepted) expect(insult.angerDelta).toBeGreaterThan(fair.angerDelta + 20);
  });

  it('penalizes repeated low offers and never counters through the floor', () => {
    const first = resolveNpcOffer({ ...base, totalOffer: cents(40_000) });
    const repeated = resolveNpcOffer({ ...base, totalOffer: cents(40_000), lastOffer: cents(40_000) });
    if (!first.accepted && !repeated.accepted) {
      expect(repeated.angerDelta).toBe(first.angerDelta + base.repetitionPenalty);
      expect(repeated.counterPrice).toBeGreaterThanOrEqual(base.sellerFloor);
      expect(repeated.counterPrice).toBeLessThan(base.counterPrice);
    }
  });

  it('walks at 100 anger and clamps there', () => {
    const result = resolveNpcOffer({ ...base, totalOffer: cents(1), anger: 92 });
    expect(result).toMatchObject({ accepted: false, walked: true, anger: 100 });
  });

  it('describes slider risk without exposing the hidden floor', () => {
    expect(offerRisk(cents(49_000), cents(50_000), 0)).toBe('comfortable');
    expect(offerRisk(cents(44_000), cents(50_000), 10)).toBe('pushing_it');
    expect(offerRisk(cents(35_000), cents(50_000), 20)).toBe('risky');
    expect(offerRisk(cents(20_000), cents(50_000), 20)).toBe('insulting');
  });
});
