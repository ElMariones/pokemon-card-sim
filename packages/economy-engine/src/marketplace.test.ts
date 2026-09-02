import { describe, it, expect } from 'vitest';
import { cents } from '../../shared/src/index';
import {
  visitChance, expectedVisitsToSell, outlookFor, resolveVisits, netProceeds,
  makeBuyer, CLIENT_INTERVAL_SECONDS, MAX_CATCHUP_VISITS, MARKETPLACE_FEE_BP,
  MIN_FEE_BEARING_SALE,
} from './marketplace';
import { mulberry32 } from './rng';
import { dealerBuyOffer } from './pricing';

const MARKET = cents(1_000);
const at = (ratio: number) => ({
  askPrice: cents(MARKET * ratio),
  marketValue: MARKET,
  rarityTier: 'holo_rare' as const,
});

describe('visit chance', () => {
  it('falls as the asking price rises', () => {
    const ratios = [0.8, 1.0, 1.2, 1.5, 2.0, 3.0];
    const chances = ratios.map((r) => visitChance(at(r)));
    for (let i = 1; i < chances.length; i++) {
      expect(chances[i]!).toBeLessThan(chances[i - 1]!);
    }
  });

  /**
   * The promise the feature makes: price it high and it takes a while, but it
   * does sell. A zero would turn "patience" into "never", which is a different
   * and much worse mechanic.
   */
  it('never reaches zero, so an over-priced card still sells eventually', () => {
    for (const ratio of [1.2, 1.5, 2, 5, 20, 100]) {
      expect(visitChance(at(ratio))).toBeGreaterThan(0);
      expect(Number.isFinite(expectedVisitsToSell(at(ratio)))).toBe(true);
    }
  });

  it('keeps a 20%-over listing within a few minutes of visits', () => {
    const seconds = expectedVisitsToSell(at(1.2)) * CLIENT_INTERVAL_SECONDS;
    expect(seconds).toBeGreaterThan(60);      // slower than at market
    expect(seconds).toBeLessThan(30 * 60);    // but not a dead listing
  });

  it('is faster at market than above it', () => {
    expect(expectedVisitsToSell(at(1.0))).toBeLessThan(expectedVisitsToSell(at(1.2)));
  });

  it('does not keep rewarding ever-deeper discounts', () => {
    // Below the bargain floor the curve flattens: giving cards away should not
    // approach certainty on the first visitor.
    expect(visitChance(at(0.5))).toBe(visitChance(at(0.85)));
    expect(visitChance(at(0.5))).toBeLessThan(0.9);
  });

  it('gives chase rarities more traffic than bulk at the same price', () => {
    const common = visitChance({ ...at(1), rarityTier: 'common' });
    const secret = visitChance({ ...at(1), rarityTier: 'secret_rare' });
    expect(secret).toBeGreaterThan(common);
  });

  it('returns zero for a card with no market value rather than guessing', () => {
    expect(visitChance({ askPrice: cents(500), marketValue: cents(0), rarityTier: 'rare' })).toBe(0);
  });
});

describe('outlook', () => {
  it('describes the price without inventing a percentage', () => {
    expect(outlookFor(cents(800), MARKET)).toBe('quick');
    expect(outlookFor(cents(1_000), MARKET)).toBe('fair');
    expect(outlookFor(cents(1_250), MARKET)).toBe('patient');
    expect(outlookFor(cents(1_600), MARKET)).toBe('slow');
    expect(outlookFor(cents(4_000), MARKET)).toBe('stale');
  });
});

describe('resolveVisits', () => {
  const base = { ...at(1.0), listingId: 'listing-1', visitsSoFar: 0 };

  it('resolves nothing before the first buyer is due', () => {
    const r = resolveVisits({ ...base, elapsedSeconds: CLIENT_INTERVAL_SECONDS - 1 });
    expect(r.visits).toBe(0);
    expect(r.sold).toBeNull();
  });

  it('is deterministic, so refreshing cannot re-roll a visitor', () => {
    const a = resolveVisits({ ...base, elapsedSeconds: 3600 });
    const b = resolveVisits({ ...base, elapsedSeconds: 3600 });
    expect(a).toEqual(b);
  });

  it('stops at the sale rather than consuming the rest of the window', () => {
    const r = resolveVisits({ ...base, elapsedSeconds: 86_400 });
    if (r.sold) expect(r.visits).toBe(r.sold.atVisit + 1);
  });

  it('caps catch-up so a month away does not resolve forever', () => {
    const r = resolveVisits({
      ...at(50), listingId: 'never', visitsSoFar: 0,
      elapsedSeconds: 60 * 60 * 24 * 30,
    });
    expect(r.visits).toBeLessThanOrEqual(MAX_CATCHUP_VISITS);
  });

  it('continues from where it left off instead of restarting the sequence', () => {
    const first = resolveVisits({ ...at(9), listingId: 'x', visitsSoFar: 0, elapsedSeconds: 450 });
    const second = resolveVisits({
      ...at(9), listingId: 'x', visitsSoFar: first.visits, elapsedSeconds: 450,
    });
    // The second window must not simply replay the first one's rolls.
    expect(second.sold?.atVisit ?? -1).not.toBe(first.sold?.atVisit ?? -2);
  });

  /**
   * Statistical check: over many independent listings priced at market, the
   * observed sale rate should track the modelled per-visit chance.
   */
  it('sells at roughly the modelled rate across many listings', () => {
    const p = visitChance(at(1.0));
    const N = 3_000;
    let sold = 0;
    for (let i = 0; i < N; i++) {
      const r = resolveVisits({
        ...at(1.0), listingId: `bulk-${i}`, visitsSoFar: 0,
        elapsedSeconds: CLIENT_INTERVAL_SECONDS, // exactly one visitor
      });
      if (r.sold) sold++;
    }
    const observed = sold / N;
    expect(Math.abs(observed - p) / p).toBeLessThan(0.12);
  });

  it('sells nearly every market-priced listing given a long enough window', () => {
    let sold = 0;
    for (let i = 0; i < 400; i++) {
      const r = resolveVisits({
        ...at(1.0), listingId: `long-${i}`, visitsSoFar: 0,
        elapsedSeconds: CLIENT_INTERVAL_SECONDS * 60,
      });
      if (r.sold) sold++;
    }
    expect(sold / 400).toBeGreaterThan(0.98);
  });

  it('eventually sells a 20%-over listing too', () => {
    let sold = 0;
    for (let i = 0; i < 400; i++) {
      const r = resolveVisits({
        ...at(1.2), listingId: `over-${i}`, visitsSoFar: 0,
        elapsedSeconds: CLIENT_INTERVAL_SECONDS * 120,
      });
      if (r.sold) sold++;
    }
    expect(sold / 400).toBeGreaterThan(0.95);
  });
});

describe('proceeds', () => {
  it('never creates or destroys a cent, and always returns integers', () => {
    for (const price of [1, 19, 55, 1_000, 250_000]) {
      const { fee, net } = netProceeds(cents(price));
      expect(fee + net).toBe(price);
      expect(net).toBeLessThanOrEqual(price);
      expect(Number.isInteger(fee)).toBe(true);
      expect(Number.isInteger(net)).toBe(true);
    }
  });

  it('charges a fee on any sale large enough for it to round to a cent', () => {
    for (const price of [MIN_FEE_BEARING_SALE, cents(55), cents(1_000), cents(250_000)]) {
      expect(netProceeds(price).fee).toBeGreaterThan(0);
      expect(netProceeds(price).net).toBeLessThan(price);
    }
  });

  it('names the actual threshold: one cent lower pays no fee at all', () => {
    expect(netProceeds(cents(MIN_FEE_BEARING_SALE - 1)).fee).toBe(0);
  });

  it('is the only fee rule — `price * 0.95` is not the same function', () => {
    // The listing dialog used to quote sellers `Math.round(ask * 0.95)`, which
    // is a cent too generous on every odd multiple of ten.
    const disagreements = [];
    for (let price = 1; price <= 10_000; price += 1) {
      if (netProceeds(cents(price)).net !== Math.round(price * 0.95)) disagreements.push(price);
    }
    expect(disagreements.slice(0, 3)).toEqual([10, 30, 50]);
  });

  it('waives the fee on bulk rather than paying the seller nothing', () => {
    // 5% of a penny is not a penny. Charging a minimum here would mean handing
    // over a card and receiving zero.
    const { fee, net } = netProceeds(cents(1));
    expect(fee).toBe(0);
    expect(net).toBe(1);
  });

  /**
   * The marketplace has to beat the dealer at market price, or nobody would
   * ever wait — and it has to not beat it so hard that the dealer is pointless.
   */
  it('pays more than the dealer at market price, after the fee', () => {
    for (const market of [cents(100), cents(1_000), cents(50_000), cents(500_000)]) {
      expect(netProceeds(market).net).toBeGreaterThan(dealerBuyOffer(market));
    }
  });
});

describe('buyers', () => {
  it('are deterministic from their seed', () => {
    expect(makeBuyer(mulberry32(42))).toEqual(makeBuyer(mulberry32(42)));
  });

  it('produce a readable name and reason', () => {
    const b = makeBuyer(mulberry32(7));
    expect(b.name).toMatch(/^[A-Z][a-z]+ [A-Z]\.$/);
    expect(b.note.length).toBeGreaterThan(0);
  });
});
