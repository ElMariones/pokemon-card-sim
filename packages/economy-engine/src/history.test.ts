import { describe, it, expect } from 'vitest';
import { cents } from '../../shared/src/index';
import { priceHistory, summarizeHistory } from './history';

const NOW = new Date('2026-08-31T12:00:00Z');

describe('priceHistory', () => {
  it('is stable for a card, so reopening shows the same chart', () => {
    const a = priceHistory('sv3pt5-6', cents(878), 'holo_rare', 90, NOW);
    const b = priceHistory('sv3pt5-6', cents(878), 'holo_rare', 90, NOW);
    expect(a).toEqual(b);
  });

  it('differs between cards', () => {
    const a = priceHistory('sv3pt5-6', cents(878), 'holo_rare', 90, NOW);
    const b = priceHistory('sv3pt5-7', cents(878), 'holo_rare', 90, NOW);
    expect(a.map((p) => p.price)).not.toEqual(b.map((p) => p.price));
  });

  /**
   * The chart must end on the number shown everywhere else on the page. A
   * series that drifts to a different final value reads as a bug even when
   * both figures are defensible.
   */
  it('ends exactly on the current price', () => {
    for (const price of [1, 55, 878, 250_00, 9_999_00]) {
      const h = priceHistory('test-card', cents(price), 'rare', 60, NOW);
      expect(h[h.length - 1]!.price).toBe(cents(price));
    }
  });

  it('returns one point per day, oldest first, ending today', () => {
    const h = priceHistory('x', cents(500), 'common', 30, NOW);
    expect(h).toHaveLength(30);
    expect(h[0]!.day).toBe('2026-08-02');
    expect(h[29]!.day).toBe('2026-08-31');
    for (let i = 1; i < h.length; i++) {
      expect(h[i]!.day > h[i - 1]!.day).toBe(true);
    }
  });

  it('never returns a zero or negative price', () => {
    for (const tier of ['common', 'secret_rare'] as const) {
      const h = priceHistory('cheap', cents(2), tier, 200, NOW);
      for (const p of h) expect(p.price).toBeGreaterThan(0);
    }
  });

  it('returns nothing for an unpriced card rather than inventing a series', () => {
    expect(priceHistory('x', cents(0), 'rare', 90, NOW)).toEqual([]);
  });

  it('moves chase cards more than commons over the same window', () => {
    const spread = (tier: 'common' | 'secret_rare') => {
      const h = priceHistory('same-seed-card', cents(10_000), tier, 90, NOW);
      const s = summarizeHistory(h);
      return (s.high - s.low) / s.last;
    };
    expect(spread('secret_rare')).toBeGreaterThan(spread('common'));
  });
});

describe('summarizeHistory', () => {
  it('reports the true low, high and change', () => {
    const h = priceHistory('sv3pt5-6', cents(1_000), 'holo_rare', 90, NOW);
    const s = summarizeHistory(h);
    expect(s.low).toBeLessThanOrEqual(s.high);
    expect(s.last).toBe(cents(1_000));
    expect(h.every((p) => p.price >= s.low && p.price <= s.high)).toBe(true);
    const expected = Math.round(((s.last - s.first) / s.first) * 10_000);
    expect(s.changeBp).toBe(expected);
  });

  it('handles an empty series', () => {
    const s = summarizeHistory([]);
    expect(s.points).toEqual([]);
    expect(s.changeBp).toBe(0);
  });
});
