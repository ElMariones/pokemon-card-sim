import { cents, type Cents, type RarityTier } from '../../shared/src/index';
import { applyBp, bp, type Bp } from './basis-points';
import { mulberry32, type Rng } from './rng';

/**
 * The player marketplace (DESIGN.md section 10).
 *
 * The dealer buys instantly at a wide spread. Listing sells for more, but only
 * when a buyer turns up and only if the price tempts them. That is the whole
 * trade: liquidity now versus a better number later.
 *
 * The rule the pricing curve has to satisfy is the one that makes the system
 * feel fair rather than random: an over-priced card must still sell
 * *eventually*. So the per-visit chance decays exponentially with the asking
 * ratio and never reaches zero. A card at 20% over market is not blocked, it
 * is slow.
 */

/** The marketplace's cut of a completed sale. */
export const MARKETPLACE_FEE_BP = bp(500); // 5%

/** One prospective buyer arrives per this many real seconds, per listing. */
export const CLIENT_INTERVAL_SECONDS = Number(
  process.env.MARKET_CLIENT_INTERVAL_SECONDS ?? 45,
);

/**
 * Catch-up is capped so a listing left for a month does not resolve tens of
 * thousands of visits in one request. At the default interval this is about
 * six hours of unattended browsing, which is far more than enough for any
 * sanely priced card to have found a buyer.
 */
export const MAX_CATCHUP_VISITS = 500;

/** Chance a single visitor buys at the asking price, before any modifiers. */
export const BASE_VISIT_CHANCE = 0.5;

/**
 * How sharply demand falls off above market value.
 *
 * Tuned so that, at one visitor per 45s:
 *   at market       roughly 30% per visit  — minutes
 *   20% over market roughly 15% per visit  — still minutes, noticeably slower
 *   50% over market roughly  5% per visit  — a long wait
 *   double market   roughly  1% per visit  — rare, but not impossible
 */
export const PRICE_SENSITIVITY = 3.5;

/** Below this ratio a buyer is not made any keener; a bargain is a bargain. */
export const BARGAIN_FLOOR_RATIO = 0.85;

/**
 * Chase cards attract more traffic than bulk. A secret rare listed at market
 * finds a buyer sooner than a common at the same ratio, because more people
 * are looking for it.
 */
export const RARITY_DEMAND: Record<RarityTier, number> = {
  energy: 0.45,
  common: 0.55,
  uncommon: 0.7,
  rare: 0.9,
  holo_rare: 1.05,
  ultra_rare: 1.2,
  secret_rare: 1.35,
  promo: 0.95,
  unknown: 0.6,
};

export interface VisitChanceInput {
  askPrice: Cents;
  marketValue: Cents;
  rarityTier: RarityTier;
}

/**
 * Probability that one visitor buys, in [0, 1).
 *
 * Never returns exactly 0 for a finite price: "eventually" has to stay true.
 */
export function visitChance({ askPrice, marketValue, rarityTier }: VisitChanceInput): number {
  if (marketValue <= 0) return 0;

  const ratio = askPrice / marketValue;
  const over = Math.max(0, ratio - BARGAIN_FLOOR_RATIO);
  const demand = RARITY_DEMAND[rarityTier] ?? 0.8;

  const chance = BASE_VISIT_CHANCE * demand * Math.exp(-PRICE_SENSITIVITY * over);

  // Clamped below 0.9 so even a giveaway takes at least a visitor or two, and
  // above zero so nothing is ever truly unsellable.
  return Math.min(0.9, Math.max(1e-6, chance));
}

/** Expected number of visitors before a sale, for the UI to explain the wait. */
export function expectedVisitsToSell(input: VisitChanceInput): number {
  const p = visitChance(input);
  return p <= 0 ? Infinity : 1 / p;
}

/** Expected wait in seconds, for the same purpose. */
export function expectedSecondsToSell(input: VisitChanceInput): number {
  return expectedVisitsToSell(input) * CLIENT_INTERVAL_SECONDS;
}

/** A plain-language read on how the price is doing. Never a fake percentage. */
export type ListingOutlook = 'quick' | 'fair' | 'patient' | 'slow' | 'stale';

export function outlookFor(askPrice: Cents, marketValue: Cents): ListingOutlook {
  if (marketValue <= 0) return 'stale';
  const ratio = askPrice / marketValue;
  if (ratio <= 0.9) return 'quick';
  if (ratio <= 1.1) return 'fair';
  if (ratio <= 1.35) return 'patient';
  if (ratio <= 1.8) return 'slow';
  return 'stale';
}

export const OUTLOOK_LABEL: Record<ListingOutlook, string> = {
  quick: 'Priced to move',
  fair: 'Around market',
  patient: 'Above market — will take a while',
  slow: 'Well above market — a long wait',
  stale: 'Far above market — may sit for a very long time',
};

// ---------------------------------------------------------------------------
// Buyers
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  'Aiko', 'Bea', 'Cyrus', 'Dahlia', 'Eiji', 'Fern', 'Goro', 'Hana', 'Ines',
  'Jonas', 'Kiri', 'Luka', 'Mei', 'Nadia', 'Oskar', 'Pia', 'Quinn', 'Rafa',
  'Sana', 'Tomas', 'Uma', 'Vik', 'Wren', 'Yuki', 'Zane',
];
const LAST_INITIALS = 'ABCDEFGHJKLMNPRSTVWY'.split('');

export interface Buyer {
  name: string;
  /** Flavour only: what drew them to the listing. */
  note: string;
}

const NOTES = [
  'building this set',
  'collects this Pokémon',
  'buying for a friend',
  'filling a binder page',
  'chasing a childhood card',
  'flipping locally',
  'grading candidate hunt',
  'just browsing the tables',
];

/** Deterministic from the seed, so a recorded sale always names the same buyer. */
export function makeBuyer(rng: Rng): Buyer {
  const first = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)]!;
  const initial = LAST_INITIALS[Math.floor(rng() * LAST_INITIALS.length)]!;
  const note = NOTES[Math.floor(rng() * NOTES.length)]!;
  return { name: `${first} ${initial}.`, note };
}

// ---------------------------------------------------------------------------
// Resolving elapsed time
// ---------------------------------------------------------------------------

export interface ResolveInput extends VisitChanceInput {
  listingId: string;
  /** Visits already resolved for this listing. */
  visitsSoFar: number;
  /** Seconds of unresolved time. */
  elapsedSeconds: number;
}

export interface ResolveResult {
  /** Visits resolved in this tick. */
  visits: number;
  /** Set when one of them bought. */
  sold: { atVisit: number; buyer: Buyer } | null;
}

/**
 * Resolve the visitors that arrived while nobody was looking.
 *
 * Each visit is seeded from the listing id and its index, so the outcome of a
 * given visit is fixed the moment the listing exists. The caller persists how
 * many visits have been consumed, so a player cannot refresh to re-roll a
 * visitor who declined.
 */
export function resolveVisits(input: ResolveInput): ResolveResult {
  const due = Math.floor(input.elapsedSeconds / CLIENT_INTERVAL_SECONDS);
  const visits = Math.min(Math.max(0, due), MAX_CATCHUP_VISITS);
  if (visits === 0) return { visits: 0, sold: null };

  const chance = visitChance(input);

  for (let i = 0; i < visits; i++) {
    const index = input.visitsSoFar + i;
    const rng = seededVisitRng(input.listingId, index);
    if (rng() < chance) {
      return { visits: i + 1, sold: { atVisit: index, buyer: makeBuyer(rng) } };
    }
  }

  return { visits, sold: null };
}

function seededVisitRng(listingId: string, visitIndex: number): Rng {
  let h = 2166136261;
  const key = `${listingId}:${visitIndex}`;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return mulberry32(h >>> 0);
}

/**
 * What the seller actually receives after the marketplace takes its cut.
 *
 * The fee rounds down, so a sale under 20 cents pays nothing — 5% of a penny
 * is not a penny. That is deliberate rather than an oversight: charging a
 * minimum fee on bulk would mean handing over a card and receiving zero, which
 * is a worse outcome than the rounding it was meant to prevent. The amounts
 * involved are trivial by construction.
 */
export function netProceeds(salePrice: Cents): { fee: Cents; net: Cents } {
  const fee = applyBp(salePrice, MARKETPLACE_FEE_BP);
  return { fee, net: cents(salePrice - fee) };
}

/** The smallest sale that actually pays a fee, given the rounding above. */
export const MIN_FEE_BEARING_SALE: Cents = cents(
  Math.ceil(10_000 / MARKETPLACE_FEE_BP),
);
