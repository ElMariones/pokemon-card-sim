import { describe, expect, it } from 'vitest';
import { cents } from '@pcs/shared';
import { MARKET_SNAPSHOTS, marketMedian } from '../../../scripts/import/pack-market-prices';

describe('2026 sealed-market snapshots', () => {
  it('has multi-market, HTTPS-backed observations for every released 2026 set', () => {
    expect(MARKET_SNAPSHOTS.map((s) => s.setId)).toEqual(['me2pt5', 'me3', 'me4', 'me5']);
    for (const snapshot of MARKET_SNAPSHOTS) {
      expect(snapshot.observations.length).toBeGreaterThanOrEqual(2);
      expect(snapshot.observations.every((o) => o.url.startsWith('https://'))).toBe(true);
      expect(snapshot.observations.every((o) => Number.isInteger(o.cents) && o.cents > 0)).toBe(true);
    }
  });

  it('uses current market valuations before a last-sold fallback', () => {
    expect(marketMedian(MARKET_SNAPSHOTS[1]!.observations)).toBe(cents(545));
    expect(marketMedian([
      { market: 'pricecharting', kind: 'last_sold', cents: cents(700), url: 'https://example.test/a' },
      { market: 'pricecharting', kind: 'last_sold', cents: cents(500), url: 'https://example.test/b' },
    ])).toBe(cents(600));
  });
});
