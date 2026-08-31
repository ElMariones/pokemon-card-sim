import { cents, type Cents, type RarityTier } from '../../shared/src/index';
import { BP_ONE, applyBp, bp, clampBp, mulBp, type Bp } from './basis-points';
import { randNormal, type Rng } from './rng';

/**
 * Market simulation (DESIGN.md section 12).
 *
 * The rule that shapes everything here: prices must be "predictable enough to
 * learn but unpredictable enough to be interesting". So movement has two
 * parts, and they are deliberately different in kind:
 *
 *   drift  — mean-reverting noise. Small, directionless, unlearnable.
 *   events — named, visible, scoped and directional. Learnable.
 *
 * A player who reads the event feed should be able to reason about which cards
 * are about to move and which way. What they cannot know is by how much, or
 * exactly when it will fade. That is the difference between a market you can
 * study and a slot machine.
 */

// ---------------------------------------------------------------------------
// Daily drift
// ---------------------------------------------------------------------------

/**
 * How hard a price is pulled back toward its baseline each tick.
 *
 * Without mean reversion a random walk eventually wanders to zero or to
 * absurdity, and the economy tests catch it as prices escaping their bounds
 * after a few thousand simulated days.
 */
export const REVERSION_STRENGTH = 0.06;

/** One standard deviation of daily noise, in basis points. */
export const DAILY_VOLATILITY_BP = 180;

/** Hard bounds. Nothing may drift below 25% or above 6x its baseline. */
export const MIN_TREND_BP = bp(2_500);
export const MAX_TREND_BP = bp(60_000);

/** Chase cards move more than bulk, as they do in the real hobby. */
export const RARITY_VOLATILITY: Record<RarityTier, number> = {
  energy: 0.3,
  common: 0.4,
  uncommon: 0.5,
  rare: 0.8,
  holo_rare: 1.1,
  ultra_rare: 1.4,
  secret_rare: 1.8,
  promo: 1.0,
  unknown: 0.5,
};

export interface DriftInput {
  /** Current multiplier over the baseline price, in basis points. */
  trendBp: Bp;
  rarityTier: RarityTier;
  rng: Rng;
}

/** Advance one card's trend by a single day. */
export function driftTrend({ trendBp, rarityTier, rng }: DriftInput): Bp {
  const volatility = DAILY_VOLATILITY_BP * (RARITY_VOLATILITY[rarityTier] ?? 1);

  // Pull toward BP_ONE proportionally to how far it has strayed.
  const reversion = (BP_ONE - trendBp) * REVERSION_STRENGTH;
  const shock = randNormal(rng) * volatility;

  return clampBp(bp(trendBp + reversion + shock), MIN_TREND_BP, MAX_TREND_BP);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type EventKind =
  | 'game_release'
  | 'anime_focus'
  | 'championship'
  | 'influencer_hype'
  | 'nostalgia_wave'
  | 'reprint'
  | 'supply_dump'
  | 'vintage_week';

/** What an event applies to. An event with no scope keys applies to everything. */
export interface EventScope {
  setId?: string;
  era?: string;
  rarityTier?: RarityTier;
  pokemonName?: string;
}

export interface MarketEvent {
  id: string;
  kind: EventKind;
  headline: string;
  body: string;
  scope: EventScope;
  /** Signed multiplier applied over the event's life, in basis points. */
  magnitudeBp: Bp;
  startsAt: Date;
  endsAt: Date;
}

/**
 * Event templates.
 *
 * `direction` is part of the definition, not a roll, because a reprint that
 * sometimes raised prices would make the feed unreadable. Only the magnitude
 * and the scope are random.
 */
export const EVENT_TEMPLATES: Record<
  EventKind,
  {
    direction: 1 | -1;
    minBp: number;
    maxBp: number;
    days: [number, number];
    headline: (scope: string) => string;
    body: string;
  }
> = {
  game_release: {
    direction: 1, minBp: 1_200, maxBp: 4_000, days: [7, 21],
    headline: (s) => `New game announcement lifts ${s}`,
    body: 'A mainline game reveal has pulled lapsed collectors back into the hobby.',
  },
  anime_focus: {
    direction: 1, minBp: 800, maxBp: 2_500, days: [5, 14],
    headline: (s) => `Anime arc puts ${s} back in demand`,
    body: 'A featured Pokémon is driving searches and sales for its older printings.',
  },
  championship: {
    direction: 1, minBp: 600, maxBp: 2_000, days: [3, 10],
    headline: (s) => `Championship results move ${s}`,
    body: 'Competitive results have made a staple suddenly hard to find.',
  },
  influencer_hype: {
    direction: 1, minBp: 1_500, maxBp: 6_000, days: [2, 6],
    headline: (s) => `A big opening video spikes ${s}`,
    body: 'A large channel opened this product on stream. Expect the spike to fade.',
  },
  nostalgia_wave: {
    direction: 1, minBp: 1_000, maxBp: 3_500, days: [10, 30],
    headline: (s) => `Nostalgia wave for ${s}`,
    body: 'Anniversary coverage has renewed interest in the era.',
  },
  reprint: {
    direction: -1, minBp: 1_000, maxBp: 3_500, days: [14, 40],
    headline: (s) => `Reprint announced: ${s} softens`,
    body: 'A confirmed reprint has increased expected supply.',
  },
  supply_dump: {
    direction: -1, minBp: 1_500, maxBp: 4_500, days: [5, 15],
    headline: (s) => `Sealed case break floods ${s}`,
    body: 'A large quantity hit the market at once and prices are absorbing it.',
  },
  vintage_week: {
    direction: 1, minBp: 1_500, maxBp: 5_000, days: [5, 12],
    headline: (s) => `Vintage week: ${s} in demand`,
    body: 'Auction houses are running vintage-focused sales.',
  },
};

export interface GenerateEventInput {
  rng: Rng;
  now: Date;
  /** Candidate scopes to draw from, e.g. sets and eras present in the catalogue. */
  scopes: { label: string; scope: EventScope }[];
  id: string;
}

export function generateEvent({ rng, now, scopes, id }: GenerateEventInput): MarketEvent | null {
  if (scopes.length === 0) return null;

  const kinds = Object.keys(EVENT_TEMPLATES) as EventKind[];
  const kind = kinds[Math.floor(rng() * kinds.length)]!;
  const template = EVENT_TEMPLATES[kind];
  const target = scopes[Math.floor(rng() * scopes.length)]!;

  const magnitude = template.minBp + rng() * (template.maxBp - template.minBp);
  const days = template.days[0] + rng() * (template.days[1] - template.days[0]);

  return {
    id,
    kind,
    headline: template.headline(target.label),
    body: template.body,
    scope: target.scope,
    magnitudeBp: bp(magnitude * template.direction),
    startsAt: now,
    endsAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000),
  };
}

export interface CardForEvent {
  setId: string;
  era: string;
  rarityTier: RarityTier;
  name: string;
}

/** Whether an event touches a given card. Empty scope means everything. */
export function eventApplies(event: MarketEvent, card: CardForEvent): boolean {
  const s = event.scope;
  if (s.setId && s.setId !== card.setId) return false;
  if (s.era && s.era !== card.era) return false;
  if (s.rarityTier && s.rarityTier !== card.rarityTier) return false;
  if (s.pokemonName && !card.name.toLowerCase().includes(s.pokemonName.toLowerCase())) {
    return false;
  }
  return true;
}

/**
 * An event's current strength, as a multiplier in basis points.
 *
 * Effect ramps in over the first fifth of its life and decays over the rest,
 * so a spike arrives fast and bleeds away slowly — the shape hype actually has.
 * An event outside its window has no effect at all.
 */
export function eventMultiplierBp(event: MarketEvent, now: Date): Bp {
  const start = event.startsAt.getTime();
  const end = event.endsAt.getTime();
  const t = now.getTime();
  if (t < start || t >= end) return BP_ONE;

  const progress = (t - start) / (end - start);
  const RAMP = 0.2;
  const shape = progress < RAMP ? progress / RAMP : 1 - (progress - RAMP) / (1 - RAMP);

  return bp(BP_ONE + event.magnitudeBp * shape);
}

/** Combined effect of every active event on one card. */
export function combinedEventBp(
  events: readonly MarketEvent[],
  card: CardForEvent,
  now: Date,
): Bp {
  let combined = BP_ONE;
  for (const e of events) {
    if (!eventApplies(e, card)) continue;
    combined = mulBp(combined, eventMultiplierBp(e, now));
  }
  return combined;
}

/** Final market price for a card: baseline × trend × active events. */
export function marketPrice(base: Cents, trendBp: Bp, eventBp: Bp): Cents {
  const price = applyBp(base, mulBp(trendBp, eventBp));
  return price < 5 ? cents(5) : price;
}
