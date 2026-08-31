import { describe, it, expect } from 'vitest';
import { cents } from '../../shared/src/index';
import { mulberry32 } from './rng';
import { BP_ONE, bp, bpToRatio } from './basis-points';
import {
  PRODUCT_SHAPES, shapeFor, sealedBaseValue, sealedRetailPrice, sealedBuyOffer,
  driftSealed, yearsSince, SEALED_MIN_BP, SEALED_MAX_BP,
} from './sealed';

const PACK = cents(500); // $5.00

describe('sealed pricing', () => {
  it('values every product above the raw packs inside it', () => {
    for (const shape of PRODUCT_SHAPES) {
      const raw = PACK * shape.packs;
      expect(sealedBaseValue(PACK, shape)).toBeGreaterThan(raw);
    }
  });

  it('charges more at retail than the product is worth held', () => {
    for (const shape of PRODUCT_SHAPES) {
      expect(sealedRetailPrice(PACK, shape)).toBeGreaterThan(sealedBaseValue(PACK, shape));
    }
  });

  /**
   * The property that stops sealed being a money printer: buying and
   * immediately reselling must lose money. Holding has to earn its return
   * through time, not through the transaction itself.
   */
  it('makes buy-then-immediately-sell strictly lossy', () => {
    for (const shape of PRODUCT_SHAPES) {
      const paid = sealedRetailPrice(PACK, shape);
      const backImmediately = sealedBuyOffer(sealedBaseValue(PACK, shape));
      expect(backImmediately).toBeLessThan(paid);
    }
  });

  it('scales with pack price, so no per-set configuration is needed', () => {
    const box = shapeFor('booster_box')!;
    expect(sealedBaseValue(cents(1_000), box)).toBeGreaterThan(sealedBaseValue(cents(500), box));
  });

  it('knows every declared product type', () => {
    for (const shape of PRODUCT_SHAPES) {
      expect(shapeFor(shape.type)).toBeDefined();
      expect(shape.packs).toBeGreaterThan(0);
    }
  });
});

describe('sealed drift', () => {
  it('stays bounded over 10,000 simulated days', () => {
    const rng = mulberry32(4242);
    let trend = BP_ONE;
    for (let d = 0; d < 10_000; d++) {
      trend = driftSealed(trend, rng, 3);
      expect(Number.isFinite(trend)).toBe(true);
      expect(trend).toBeGreaterThanOrEqual(SEALED_MIN_BP);
      expect(trend).toBeLessThanOrEqual(SEALED_MAX_BP);
    }
  });

  it('trends upward over years rather than reverting to its start', () => {
    const run = (seed: number) => {
      const rng = mulberry32(seed);
      let trend = BP_ONE;
      for (let d = 0; d < 365 * 3; d++) trend = driftSealed(trend, rng, 2);
      return bpToRatio(trend);
    };
    // Averaged across seeds so this asserts the bias, not one lucky walk.
    const runs = [1, 2, 3, 4, 5, 6, 7, 8].map(run);
    const mean = runs.reduce((a, b) => a + b, 0) / runs.length;
    expect(mean).toBeGreaterThan(1.05);
  });

  it('appreciates older sealed faster than new', () => {
    const run = (years: number) => {
      const rng = mulberry32(77);
      let trend = BP_ONE;
      for (let d = 0; d < 365; d++) trend = driftSealed(trend, rng, years);
      return trend;
    };
    expect(run(20)).toBeGreaterThan(run(0));
  });

  it('is not a guaranteed win inside a single year', () => {
    // Across many seeds some one-year holds must lose, or holding is riskless.
    let losses = 0;
    for (let seed = 0; seed < 60; seed++) {
      const rng = mulberry32(seed);
      let trend = BP_ONE;
      for (let d = 0; d < 365; d++) trend = driftSealed(trend, rng, 0);
      if (trend < BP_ONE) losses++;
    }
    expect(losses).toBeGreaterThan(0);
  });
});

describe('yearsSince', () => {
  it('measures elapsed years and never returns a negative', () => {
    const now = new Date('2026-08-31');
    expect(yearsSince('1999-01-09', now)).toBeGreaterThan(27);
    expect(yearsSince('2026-08-01', now)).toBeLessThan(1);
    expect(yearsSince('2030-01-01', now)).toBe(0);
    expect(yearsSince('not a date', now)).toBe(0);
  });
});
