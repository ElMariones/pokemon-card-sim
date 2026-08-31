import { describe, it, expect } from 'vitest';
import { makeRng, hashSeed, createSeed, weightedPick, weightedPickDistinct } from './rng.js';

describe('makeRng', () => {
  it('is deterministic for a given seed', () => {
    const a = Array.from({ length: 50 }, makeRng('seed-alpha'));
    const b = Array.from({ length: 50 }, makeRng('seed-alpha'));
    expect(a).toEqual(b);
  });

  it('produces different streams for different seeds', () => {
    const a = Array.from({ length: 20 }, makeRng('alpha'));
    const b = Array.from({ length: 20 }, makeRng('beta'));
    expect(a).not.toEqual(b);
  });

  it('stays within [0, 1)', () => {
    const rng = makeRng('bounds');
    for (let i = 0; i < 200_000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is uniform across 10 buckets over 500k draws', () => {
    const rng = makeRng('uniformity');
    const buckets = new Array(10).fill(0);
    const N = 500_000;
    for (let i = 0; i < N; i++) buckets[Math.floor(rng() * 10)]++;

    // Chi-square with 9 degrees of freedom; 27.88 is the 0.999 critical value.
    const expected = N / 10;
    const chi2 = buckets.reduce((acc, o) => acc + (o - expected) ** 2 / expected, 0);
    expect(chi2).toBeLessThan(27.88);
  });
});

describe('hashSeed', () => {
  it('is stable and does not leak the seed', () => {
    const seed = 'super-secret-seed';
    expect(hashSeed(seed)).toBe(hashSeed(seed));
    expect(hashSeed(seed)).toHaveLength(64);
    expect(hashSeed(seed)).not.toContain(seed);
  });

  it('gives distinct hashes for distinct seeds', () => {
    const seeds = new Set(Array.from({ length: 1000 }, () => hashSeed(createSeed())));
    expect(seeds.size).toBe(1000);
  });
});

describe('weightedPick', () => {
  it('respects declared weights within 2% relative error over 200k draws', () => {
    const entries = [
      { id: 'a', weight: 70 },
      { id: 'b', weight: 20 },
      { id: 'c', weight: 10 },
    ];
    const rng = makeRng('weights');
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    const N = 200_000;
    for (let i = 0; i < N; i++) counts[weightedPick(entries, rng).id]!++;

    for (const e of entries) {
      const observed = counts[e.id]! / N;
      const expected = e.weight / 100;
      expect(Math.abs(observed - expected) / expected).toBeLessThan(0.02);
    }
  });

  it('never selects a zero-weight entry', () => {
    const entries = [
      { id: 'live', weight: 1 },
      { id: 'disabled', weight: 0 },
      { id: 'negative', weight: -5 },
    ];
    const rng = makeRng('zero-weight');
    for (let i = 0; i < 100_000; i++) {
      expect(weightedPick(entries, rng).id).toBe('live');
    }
  });

  it('handles extreme weight ratios', () => {
    const entries = [
      { id: 'common', weight: 1_000_000 },
      { id: 'jackpot', weight: 1 },
    ];
    const rng = makeRng('extremes');
    let jackpots = 0;
    const N = 2_000_000;
    for (let i = 0; i < N; i++) if (weightedPick(entries, rng).id === 'jackpot') jackpots++;
    // Expect ~2 in 2M. Assert it is plausible rather than exact.
    expect(jackpots).toBeLessThan(15);
  });

  it('throws on an empty or fully-zero table rather than returning undefined', () => {
    const rng = makeRng('empty');
    expect(() => weightedPick([], rng)).toThrow(/empty/i);
    expect(() => weightedPick([{ weight: 0 }], rng)).toThrow(/positively-weighted/i);
  });
});

describe('weightedPickDistinct', () => {
  it('returns distinct entries', () => {
    const entries = Array.from({ length: 50 }, (_, i) => ({ id: `c${i}`, weight: 1 }));
    const rng = makeRng('distinct');
    const picked = weightedPickDistinct(entries, 10, rng, (e) => e.id);
    expect(picked).toHaveLength(10);
    expect(new Set(picked.map((p) => p.id)).size).toBe(10);
  });

  it('returns everything available when asked for more than exists', () => {
    const entries = [
      { id: 'a', weight: 1 },
      { id: 'b', weight: 1 },
    ];
    const rng = makeRng('exhausted');
    const picked = weightedPickDistinct(entries, 10, rng, (e) => e.id);
    expect(picked).toHaveLength(2);
  });

  it('terminates when one entry dominates the weight', () => {
    const entries = [
      { id: 'dominant', weight: 10_000_000 },
      { id: 'rare1', weight: 1 },
      { id: 'rare2', weight: 1 },
    ];
    const rng = makeRng('dominant');
    const picked = weightedPickDistinct(entries, 3, rng, (e) => e.id);
    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((p) => p.id)).size).toBe(3);
  });
});
