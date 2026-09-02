import { describe, expect, it } from 'vitest';
import { cents } from '@pcs/shared';
import { MIN_PACK_PRICE, medianCents, resolvePackPrice } from './pricing';

describe('resolvePackPrice', () => {
  it('prefers a hand-reviewed snapshot over the daily feed', () => {
    const r = resolvePackPrice({ curated: cents(1382), market: cents(1400), eraMedian: cents(900) });
    expect(r).toMatchObject({ price: 1382, source: 'curated' });
  });

  it('uses the real sealed market price when there is one', () => {
    const r = resolvePackPrice({ market: cents(579), eraMedian: cents(900), simulatedEv: cents(4000) });
    expect(r).toMatchObject({ price: 579, source: 'market', confidence: 'documented_community_data' });
  });

  it('inherits the parent set\'s pack before falling back to an era median', () => {
    // A Trainer Gallery card comes out of the parent set's pack; there is no
    // such thing as a Trainer Gallery booster.
    const r = resolvePackPrice({ inherited: cents(1475), eraMedian: cents(1489) });
    expect(r).toMatchObject({ price: 1475, source: 'inherited', confidence: 'estimated' });
  });

  it('prefers the set\'s own market price over an inherited one', () => {
    const r = resolvePackPrice({ market: cents(579), inherited: cents(1475) });
    expect(r?.source).toBe('market');
  });

  it('falls back to the era median for a set that never had a booster pack', () => {
    const r = resolvePackPrice({ eraMedian: cents(1250), simulatedEv: cents(4000) });
    expect(r).toMatchObject({ price: 1250, source: 'era_median', confidence: 'estimated' });
  });

  it('falls back to the contents derivation only when no real price exists anywhere', () => {
    const r = resolvePackPrice({ simulatedEv: cents(1000) });
    expect(r).toMatchObject({ price: 1150, source: 'simulated', confidence: 'estimated' });
  });

  it('treats a zero quote as no quote', () => {
    const r = resolvePackPrice({ market: cents(0), eraMedian: cents(1250) });
    expect(r?.source).toBe('era_median');
  });

  it('reports a real market price below the floor rather than inflating it', () => {
    expect(resolvePackPrice({ market: cents(99) })?.price).toBe(99);
  });

  it('holds estimated prices to the minimum pack price', () => {
    expect(resolvePackPrice({ eraMedian: cents(50) })?.price).toBe(MIN_PACK_PRICE);
    expect(resolvePackPrice({ simulatedEv: cents(10) })?.price).toBe(MIN_PACK_PRICE);
  });

  it('has no price at all when every source is empty', () => {
    expect(resolvePackPrice({})).toBeNull();
  });
});

describe('medianCents', () => {
  it('takes the middle of an odd sample', () => {
    expect(medianCents([cents(100), cents(300), cents(200)])).toBe(200);
  });

  it('averages the two middles of an even sample', () => {
    expect(medianCents([cents(100), cents(200), cents(300), cents(500)])).toBe(250);
  });

  it('is null for an empty sample', () => {
    expect(medianCents([])).toBeNull();
  });
});
