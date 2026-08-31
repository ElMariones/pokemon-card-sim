import { cents, type Cents } from '../../shared/src/index';

/**
 * Collector levels, XP and missions (DESIGN.md sections 15 and 16).
 *
 * Pure: this module decides what a level is and whether a mission is complete.
 * Persisting progress is the app's job.
 *
 * Unlocks are gated on progression only, never on money, so a player cannot
 * buy their way past the parts of the game that teach it.
 */

export interface CollectorLevel {
  level: number;
  title: string;
  xpRequired: number;
  unlocks: string[];
}

export const LEVELS: readonly CollectorLevel[] = [
  { level: 1,  title: 'Casual Collector', xpRequired: 0,      unlocks: ['packs', 'collection'] },
  { level: 2,  title: 'Rookie',           xpRequired: 250,    unlocks: ['sell_duplicates'] },
  { level: 3,  title: 'Regular',          xpRequired: 750,    unlocks: ['set_pages', 'daily_missions'] },
  { level: 4,  title: 'Enthusiast',       xpRequired: 1_800,  unlocks: ['vintage_sets'] },
  { level: 5,  title: 'Serious Collector',xpRequired: 3_500,  unlocks: ['grading', 'larger_album'] },
  { level: 6,  title: 'Trader',           xpRequired: 6_500,  unlocks: ['singles_market', 'price_history'] },
  { level: 7,  title: 'Investor',         xpRequired: 11_000, unlocks: ['sealed_market'] },
  { level: 8,  title: 'Grading Expert',   xpRequired: 18_000, unlocks: ['premium_grading', 'bulk_submit'] },
  { level: 9,  title: 'Dealer',           xpRequired: 30_000, unlocks: ['bulk_selling', 'advanced_stats'] },
  { level: 10, title: 'Card Shop Owner',  xpRequired: 50_000, unlocks: ['shop', 'auctions'] },
];

export const MAX_LEVEL = LEVELS[LEVELS.length - 1]!.level;

export function levelForXp(xp: number): CollectorLevel {
  let current = LEVELS[0]!;
  for (const l of LEVELS) if (xp >= l.xpRequired) current = l;
  return current;
}

export function nextLevel(xp: number): CollectorLevel | null {
  return LEVELS.find((l) => l.xpRequired > xp) ?? null;
}

/** Progress toward the next level, in basis points. */
export function levelProgressBp(xp: number): number {
  const current = levelForXp(xp);
  const next = nextLevel(xp);
  if (!next) return 10_000;
  const span = next.xpRequired - current.xpRequired;
  return span <= 0 ? 10_000 : Math.round(((xp - current.xpRequired) / span) * 10_000);
}

export function unlockedFeatures(xp: number): Set<string> {
  const out = new Set<string>();
  for (const l of LEVELS) {
    if (l.xpRequired <= xp) for (const u of l.unlocks) out.add(u);
  }
  return out;
}

export const hasUnlocked = (xp: number, feature: string): boolean =>
  unlockedFeatures(xp).has(feature);

// ---------------------------------------------------------------------------
// XP awards
// ---------------------------------------------------------------------------

/**
 * XP is awarded for things that build a collection, not for spending money.
 * Opening a pack is worth little; completing a set is worth a great deal.
 * Otherwise the fastest route to level 10 would be to burn cash on packs,
 * which is exactly the behaviour DESIGN.md section 30 warns against.
 */
export const XP_AWARDS = {
  pack_opened: 10,
  new_card: 5,
  duplicate_card: 1,
  card_sold: 2,
  card_graded: 25,
  gem_mint_pulled: 150,
  hit_pulled: 20,
  set_completed: 2_000,
  set_half_complete: 300,
  mission_completed: 50,
} as const;

export type XpReason = keyof typeof XP_AWARDS;

export interface XpResult {
  xpGained: number;
  totalXp: number;
  previousLevel: number;
  newLevel: number;
  leveledUp: boolean;
  newUnlocks: string[];
}

export function awardXp(currentXp: number, reason: XpReason, count = 1): XpResult {
  const gained = XP_AWARDS[reason] * count;
  const total = currentXp + gained;
  const before = levelForXp(currentXp);
  const after = levelForXp(total);

  const previousUnlocks = unlockedFeatures(currentXp);
  const newUnlocks = [...unlockedFeatures(total)].filter((u) => !previousUnlocks.has(u));

  return {
    xpGained: gained,
    totalXp: total,
    previousLevel: before.level,
    newLevel: after.level,
    leveledUp: after.level > before.level,
    newUnlocks,
  };
}

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

export type Cadence = 'daily' | 'weekly' | 'long_term';

export type MissionMetric =
  | 'packs_opened'
  | 'cards_sold'
  | 'unique_cards_added'
  | 'cards_graded'
  | 'profit_earned'
  | 'sets_completed'
  | 'gem_mint_owned'
  | 'collection_value';

export interface MissionTemplate {
  id: string;
  cadence: Cadence;
  metric: MissionMetric;
  target: number;
  title: string;
  rewardCash: Cents;
  rewardXp: number;
  /** Minimum collector level before this mission can be offered. */
  minLevel?: number;
}

export const MISSION_TEMPLATES: readonly MissionTemplate[] = [
  // Daily
  { id: 'daily_open_3',    cadence: 'daily', metric: 'packs_opened',      target: 3,  title: 'Open 3 packs',                 rewardCash: cents(1_500), rewardXp: 50 },
  { id: 'daily_sell_5',    cadence: 'daily', metric: 'cards_sold',        target: 5,  title: 'Sell 5 cards to the dealer',   rewardCash: cents(1_000), rewardXp: 40 },
  { id: 'daily_unique_10', cadence: 'daily', metric: 'unique_cards_added',target: 10, title: 'Add 10 new cards to your album', rewardCash: cents(2_000), rewardXp: 60 },

  // Weekly
  { id: 'weekly_open_25',  cadence: 'weekly', metric: 'packs_opened',     target: 25, title: 'Open 25 packs',                rewardCash: cents(10_000), rewardXp: 300 },
  { id: 'weekly_grade_3',  cadence: 'weekly', metric: 'cards_graded',     target: 3,  title: 'Send 3 cards for grading',     rewardCash: cents(8_000),  rewardXp: 250, minLevel: 5 },
  { id: 'weekly_unique_50',cadence: 'weekly', metric: 'unique_cards_added',target: 50, title: 'Add 50 new cards',            rewardCash: cents(12_000), rewardXp: 350 },

  // Long term
  { id: 'lt_set_1',        cadence: 'long_term', metric: 'sets_completed',   target: 1,       title: 'Complete a full set',            rewardCash: cents(50_000), rewardXp: 1_500 },
  { id: 'lt_gem_mint',     cadence: 'long_term', metric: 'gem_mint_owned',   target: 1,       title: 'Own a Gem Mint 10',              rewardCash: cents(25_000), rewardXp: 1_000, minLevel: 5 },
  { id: 'lt_value_10k',    cadence: 'long_term', metric: 'collection_value', target: 1_000_000, title: 'Reach $10,000 collection value', rewardCash: cents(40_000), rewardXp: 1_200 },
  { id: 'lt_unique_500',   cadence: 'long_term', metric: 'unique_cards_added', target: 500,   title: 'Own 500 unique cards',           rewardCash: cents(30_000), rewardXp: 1_000 },
];

export const missionsFor = (cadence: Cadence, level: number): MissionTemplate[] =>
  MISSION_TEMPLATES.filter(
    (m) => m.cadence === cadence && (m.minLevel ?? 1) <= level,
  );

export const isMissionComplete = (progress: number, target: number): boolean =>
  progress >= target;

/** When the current daily/weekly window ends, so missions can reset. */
export function windowEnd(cadence: Cadence, now = new Date()): Date | null {
  if (cadence === 'long_term') return null;
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() + (cadence === 'daily' ? 1 : 7));
  return end;
}
