import { describe, it, expect } from 'vitest';
import { cents } from '../../shared/src/index';
import { mulberry32 } from './rng';
import { BP_ONE, bp, bpToRatio } from './basis-points';
import {
  driftTrend, generateEvent, eventApplies, eventMultiplierBp, combinedEventBp,
  marketPrice, MIN_TREND_BP, MAX_TREND_BP, EVENT_TEMPLATES,
  type MarketEvent, type CardForEvent,
} from './market';

const CARD: CardForEvent = {
  setId: 'sv3pt5', era: 'sv', rarityTier: 'holo_rare', name: 'Charizard ex',
};

describe('price drift', () => {
  /**
   * The bug this exists to catch: a random walk with no mean reversion
   * eventually wanders to zero or to absurdity, and it takes thousands of
   * simulated days to show up. Ten thousand days per rarity is cheap insurance.
   */
  it('keeps prices bounded over 10,000 simulated days', () => {
    for (const tier of ['common', 'holo_rare', 'secret_rare'] as const) {
      const rng = mulberry32(20260831);
      let trend = BP_ONE;
      let min = trend;
      let max = trend;

      for (let day = 0; day < 10_000; day++) {
        trend = driftTrend({ trendBp: trend, rarityTier: tier, rng });
        min = Math.min(min, trend) as typeof trend;
        max = Math.max(max, trend) as typeof trend;
        expect(Number.isFinite(trend)).toBe(true);
      }

      expect(min).toBeGreaterThanOrEqual(MIN_TREND_BP);
      expect(max).toBeLessThanOrEqual(MAX_TREND_BP);
    }
  });

  it('reverts toward the baseline rather than staying where it is pushed', () => {
    const rng = mulberry32(7);
    let trend = bp(40_000); // 4x over baseline
    for (let day = 0; day < 400; day++) {
      trend = driftTrend({ trendBp: trend, rarityTier: 'common', rng });
    }
    // It should have come most of the way back rather than parking at 4x.
    expect(bpToRatio(trend)).toBeLessThan(2);
  });

  it('moves chase cards more than bulk', () => {
    const spread = (tier: 'common' | 'secret_rare') => {
      const rng = mulberry32(99);
      let trend = BP_ONE;
      let sum = 0;
      for (let d = 0; d < 3_000; d++) {
        const next = driftTrend({ trendBp: trend, rarityTier: tier, rng });
        sum += Math.abs(next - trend);
        trend = next;
      }
      return sum / 3_000;
    };
    expect(spread('secret_rare')).toBeGreaterThan(spread('common'));
  });
});

describe('market events', () => {
  const scopes = [
    { label: '151', scope: { setId: 'sv3pt5' } },
    { label: 'vintage', scope: { era: 'classic' } },
  ];

  it('always produces an event with a direction matching its kind', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 500; i++) {
      const e = generateEvent({ rng, now: new Date(), scopes, id: `e${i}` })!;
      const expected = EVENT_TEMPLATES[e.kind].direction;
      expect(Math.sign(e.magnitudeBp)).toBe(expected);
    }
  });

  it('is learnable: a reprint never raises a price and hype never lowers one', () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 300; i++) {
      const e = generateEvent({ rng, now: new Date(), scopes, id: `e${i}` })!;
      const mid = new Date((e.startsAt.getTime() + e.endsAt.getTime()) / 2);
      const mult = eventMultiplierBp(e, mid);
      if (e.kind === 'reprint' || e.kind === 'supply_dump') {
        expect(mult).toBeLessThanOrEqual(BP_ONE);
      } else {
        expect(mult).toBeGreaterThanOrEqual(BP_ONE);
      }
    }
  });

  it('scopes correctly and ignores cards it does not target', () => {
    const setEvent: MarketEvent = {
      id: 'x', kind: 'influencer_hype', headline: '', body: '',
      scope: { setId: 'sv3pt5' }, magnitudeBp: bp(3_000),
      startsAt: new Date(), endsAt: new Date(Date.now() + 86_400_000),
    };
    expect(eventApplies(setEvent, CARD)).toBe(true);
    expect(eventApplies(setEvent, { ...CARD, setId: 'base1' })).toBe(false);

    const eraEvent: MarketEvent = { ...setEvent, scope: { era: 'classic' } };
    expect(eventApplies(eraEvent, CARD)).toBe(false);
    expect(eventApplies(eraEvent, { ...CARD, era: 'classic' })).toBe(true);

    const nameEvent: MarketEvent = { ...setEvent, scope: { pokemonName: 'charizard' } };
    expect(eventApplies(nameEvent, CARD)).toBe(true);
    expect(eventApplies(nameEvent, { ...CARD, name: 'Magikarp' })).toBe(false);
  });

  it('has no effect outside its window', () => {
    const now = new Date('2026-06-01');
    const e: MarketEvent = {
      id: 'x', kind: 'vintage_week', headline: '', body: '', scope: {},
      magnitudeBp: bp(4_000),
      startsAt: new Date('2026-06-10'), endsAt: new Date('2026-06-20'),
    };
    expect(eventMultiplierBp(e, now)).toBe(BP_ONE);
    expect(eventMultiplierBp(e, new Date('2026-07-01'))).toBe(BP_ONE);
    expect(eventMultiplierBp(e, new Date('2026-06-15'))).toBeGreaterThan(BP_ONE);
  });

  it('ramps in faster than it decays, the shape hype actually has', () => {
    const start = new Date('2026-06-01').getTime();
    const end = new Date('2026-06-11').getTime();
    const e: MarketEvent = {
      id: 'x', kind: 'influencer_hype', headline: '', body: '', scope: {},
      magnitudeBp: bp(5_000), startsAt: new Date(start), endsAt: new Date(end),
    };
    const at = (p: number) => eventMultiplierBp(e, new Date(start + (end - start) * p));
    // Peak sits at the 20% mark, not the midpoint.
    expect(at(0.2)).toBeGreaterThan(at(0.1));
    expect(at(0.2)).toBeGreaterThan(at(0.5));
    expect(at(0.5)).toBeGreaterThan(at(0.9));
  });

  it('compounds multiple events on one card', () => {
    const now = new Date('2026-06-05');
    const mk = (scope: object, magnitude: number): MarketEvent => ({
      id: Math.random().toString(), kind: 'nostalgia_wave', headline: '', body: '',
      scope, magnitudeBp: bp(magnitude),
      startsAt: new Date('2026-06-01'), endsAt: new Date('2026-06-30'),
    });
    const one = combinedEventBp([mk({ setId: 'sv3pt5' }, 2_000)], CARD, now);
    const two = combinedEventBp(
      [mk({ setId: 'sv3pt5' }, 2_000), mk({ rarityTier: 'holo_rare' }, 2_000)],
      CARD,
      now,
    );
    expect(two).toBeGreaterThan(one);
  });
});

describe('marketPrice', () => {
  it('never returns a price below the floor', () => {
    expect(marketPrice(cents(1), MIN_TREND_BP, bp(100))).toBeGreaterThanOrEqual(cents(5));
  });

  it('is an integer number of cents for any inputs', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 20_000; i++) {
      const p = marketPrice(
        cents(Math.floor(rng() * 500_000)),
        bp(2_500 + rng() * 57_500),
        bp(5_000 + rng() * 10_000),
      );
      expect(Number.isInteger(p)).toBe(true);
    }
  });
});
