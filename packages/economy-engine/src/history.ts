import { cents, type Cents, type RarityTier } from '../../shared/src/index';
import { BP_ONE, applyBp, bp, type Bp } from './basis-points';
import { mulberry32 } from './rng';
import { driftTrend } from './market';

/**
 * Price history.
 *
 * Generated deterministically from the card id rather than stored. Storing a
 * real series would mean roughly 1.7 million rows for 90 days across 18,850
 * priced cards, and it would still be synthetic — the simulation has not been
 * running for 90 days.
 *
 * Seeding from the card id means the same card always shows the same history,
 * so a player who reopens a card sees the chart they saw before, and nothing
 * has to be written. The price_history table stays for genuinely observed
 * movement once the market ticks in real time.
 */

export interface PricePoint {
  /** ISO date, YYYY-MM-DD. */
  day: string;
  price: Cents;
}

function seedFrom(cardId: string): number {
  let h = 2166136261;
  for (let i = 0; i < cardId.length; i++) {
    h ^= cardId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A card's price over the last `days` days, ending at its current baseline.
 *
 * The walk is generated forward from the past and then rescaled so the final
 * point lands exactly on today's price. Without that the chart would end on a
 * number that disagrees with the price shown everywhere else on the page,
 * which reads as a bug even though both are "correct".
 */
export function priceHistory(
  cardId: string,
  currentPrice: Cents,
  rarityTier: RarityTier,
  days = 90,
  now = new Date(),
): PricePoint[] {
  if (currentPrice <= 0 || days <= 0) return [];

  const rng = mulberry32(seedFrom(cardId));
  const trends: Bp[] = [];
  let trend = BP_ONE;

  for (let i = 0; i < days; i++) {
    trend = driftTrend({ trendBp: trend, rarityTier, rng });
    trends.push(trend);
  }

  const finalTrend = trends[trends.length - 1] ?? BP_ONE;
  const points: PricePoint[] = [];

  for (let i = 0; i < days; i++) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - (days - 1 - i));

    // Rescale so the series ends on today's actual price.
    const relative = bp(Math.round((trends[i]! / finalTrend) * 10_000));
    const price = applyBp(currentPrice, relative);

    points.push({
      day: date.toISOString().slice(0, 10),
      price: price < 1 ? cents(1) : price,
    });
  }

  return points;
}

export interface HistorySummary {
  points: PricePoint[];
  low: Cents;
  high: Cents;
  first: Cents;
  last: Cents;
  /** Change over the window in basis points; 0 when the series is flat. */
  changeBp: number;
}

export function summarizeHistory(points: readonly PricePoint[]): HistorySummary {
  if (points.length === 0) {
    const zero = cents(0);
    return { points: [], low: zero, high: zero, first: zero, last: zero, changeBp: 0 };
  }

  let low = points[0]!.price;
  let high = points[0]!.price;
  for (const p of points) {
    if (p.price < low) low = p.price;
    if (p.price > high) high = p.price;
  }

  const first = points[0]!.price;
  const last = points[points.length - 1]!.price;
  const changeBp = first === 0 ? 0 : Math.round(((last - first) / first) * 10_000);

  return { points: [...points], low, high, first, last, changeBp };
}
