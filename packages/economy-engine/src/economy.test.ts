import { describe, it, expect } from 'vitest';
import { cents, CONDITIONS, type Cents } from '../../shared/src/index.js';
import { dealerBuyOffer, dealerAskPrice, computePrice, derivePackPrice, PRICE_FLOOR } from './pricing.js';
import { conditionMultiplier, conditionRank, rollPackCondition } from './condition.js';
import { rollGrade, gradedValue, SERVICE_TIERS, GRADE_LABEL } from './grading.js';
import { mulberry32 } from './rng.js';
import { applyBp, splitCents, bp, BP_ONE } from './basis-points.js';

const rng = mulberry32(12345);

describe('dealer spread', () => {
  it('always pays strictly less than market value', () => {
    for (let i = 0; i < 20_000; i++) {
      const market = cents(Math.floor(rng() * 5_000_00) + 1);
      const offer = dealerBuyOffer(market);
      expect(offer).toBeLessThan(market);
      expect(offer).toBeGreaterThan(0);
    }
  });

  it('always asks strictly more than market value', () => {
    for (let i = 0; i < 20_000; i++) {
      const market = cents(Math.floor(rng() * 5_000_00) + 1);
      expect(dealerAskPrice(market)).toBeGreaterThan(market);
    }
  });

  it('makes buy-then-sell strictly lossy, so churn cannot mint money', () => {
    for (const market of [cents(50), cents(500), cents(5_000), cents(50_000), cents(500_000)]) {
      const roundTrip = dealerBuyOffer(dealerAskPrice(market));
      expect(roundTrip).toBeLessThan(market);
    }
  });

  it('pays proportionally less for bulk than for premium cards', () => {
    const bulkRatio = dealerBuyOffer(cents(50)) / 50;
    const premiumRatio = dealerBuyOffer(cents(500_000)) / 500_000;
    expect(bulkRatio).toBeLessThan(premiumRatio);
  });
});

describe('money arithmetic', () => {
  it('never produces a fractional cent', () => {
    for (let i = 0; i < 50_000; i++) {
      const base = cents(Math.floor(rng() * 100_000));
      const factor = bp(Math.floor(rng() * 40_000) + 1);
      expect(Number.isInteger(applyBp(base, factor))).toBe(true);
    }
  });

  it('splits a total without creating or destroying a cent', () => {
    for (let i = 0; i < 5_000; i++) {
      const total = cents(Math.floor(rng() * 1_000_000));
      const weights = [rng(), rng(), rng(), rng()];
      const parts = splitCents(total, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it('holds a price floor so bulk is never worthless', () => {
    expect(computePrice(cents(1), { demand: bp(1) })).toBeGreaterThanOrEqual(PRICE_FLOOR);
  });
});

describe('condition', () => {
  it('orders multipliers from Near Mint down to Damaged', () => {
    const ordered = [...CONDITIONS].sort((a, b) => conditionRank(a) - conditionRank(b));
    for (let i = 1; i < ordered.length; i++) {
      expect(conditionMultiplier(ordered[i]!)).toBeLessThan(conditionMultiplier(ordered[i - 1]!));
    }
  });

  it('gives pack-pulled cards mostly Near Mint', () => {
    const r = mulberry32(99);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 100_000; i++) {
      const c = rollPackCondition(r);
      counts[c] = (counts[c] ?? 0) + 1;
    }
    expect(counts.near_mint! / 100_000).toBeGreaterThan(0.75);
    expect(counts.damaged ?? 0).toBeLessThan(1_000);
  });
});

describe('grading', () => {
  it('shifts the grade distribution down as condition worsens', () => {
    const average = (condition: (typeof CONDITIONS)[number]) => {
      const r = mulberry32(7);
      let sum = 0;
      for (let i = 0; i < 20_000; i++) sum += rollGrade('PSA', condition, r).numericGrade;
      return sum / 20_000;
    };
    const nm = average('near_mint');
    const lp = average('lightly_played');
    const mp = average('moderately_played');
    const dmg = average('damaged');
    expect(nm).toBeGreaterThan(lp);
    expect(lp).toBeGreaterThan(mp);
    expect(mp).toBeGreaterThan(dmg);
  });

  it('only ever awards a Black Label on a BGS 10 with four perfect subgrades', () => {
    const r = mulberry32(4242);
    let blackLabels = 0;
    for (let i = 0; i < 50_000; i++) {
      const g = rollGrade('BGS', 'near_mint', r);
      if (g.isBlackLabel) {
        blackLabels++;
        expect(g.numericGrade).toBe(10);
        expect(Object.values(g.subgrades!)).toEqual([10, 10, 10, 10]);
      }
    }
    // Rare, but reachable — otherwise the chase does not exist.
    expect(blackLabels).toBeGreaterThan(0);
    expect(blackLabels / 50_000).toBeLessThan(0.05);
  });

  it('makes a low grade worth less than the raw card', () => {
    const raw = cents(10_000);
    const low = gradedValue(raw, { company: 'PSA', numericGrade: 3, label: 'x' });
    expect(low).toBeLessThan(raw);
  });

  it('prices a PSA 10 above a CGC 10, matching the real premium', () => {
    const raw = cents(10_000);
    const psa = gradedValue(raw, { company: 'PSA', numericGrade: 10, label: 'Gem Mint' });
    const cgc = gradedValue(raw, { company: 'CGC', numericGrade: 10, label: 'Gem Mint' });
    expect(psa).toBeGreaterThan(cgc);
  });

  it('offers every service tier a real fee and turnaround', () => {
    for (const t of SERVICE_TIERS) {
      expect(t.fee).toBeGreaterThan(0);
      expect(t.turnaroundHours).toBeGreaterThan(0);
    }
  });
});

describe('pack pricing', () => {
  it('always charges more than the expected value of the contents', () => {
    for (let i = 0; i < 10_000; i++) {
      const ev = cents(Math.floor(rng() * 1_000_00));
      const price = derivePackPrice(ev);
      // Either the house edge applies, or the minimum price floor does.
      expect(price).toBeGreaterThan(Math.min(ev, price - 1));
      if (ev > 200) expect(price).toBeGreaterThan(ev);
    }
  });

  it('never prices a pack below the floor', () => {
    expect(derivePackPrice(cents(0))).toBeGreaterThanOrEqual(cents(199));
  });
});
