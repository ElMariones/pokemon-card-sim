import type { Confidence, RarityTier } from '../../shared/src/index';
import type { EngineCard, EnginePackTemplate, EnginePullTable } from './types';

/**
 * Where pack structure comes from.
 *
 * The full catalogue is ~174 sets. Nobody has published pull rates for most of
 * them, so templates come in two kinds and the difference is recorded rather
 * than hidden:
 *
 *   AUTHORED — written from a cited source for a specific set. Carries
 *              'documented_community_data' when a community measured it.
 *   DERIVED  — generated from a set's era and its actual rarity composition.
 *              Always 'estimated'. Never displayed as an exact percentage.
 *
 * DESIGN.md section 5 is explicit: do not show "1.72%" unless a source
 * supports it. `confidence` is what lets the UI honour that.
 */

export interface DerivedPack {
  template: EnginePackTemplate;
  tables: EnginePullTable[];
}

interface SetLike {
  id: string;
  era: string;
  name: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Authored templates
// ───────────────────────────────────────────────────────────────────────────

/**
 * Measured community data, ~1,000+ packs, aggregated from community openings
 * and TCGplayer marketplace data.
 * Source: https://pokepatch.com/2025/05/15/scarlet-violet-151-pull-rates-in-pokemon-tcg-set/
 *
 * Reported per-card-type odds:
 *   Double Rare 13.2% · Illustration Rare 8.5% · Ultra Rare 6.4%
 *   Special Illustration Rare 3.1% · Hyper Rare 1.9%
 *
 * Folded onto our rarity tiers (see rarity-map.ts) that becomes:
 *   holo_rare 13.2 · ultra_rare 14.9 (IR + UR) · secret_rare 5.0 (SIR + HR)
 *   rare 66.9 (the residual — roughly the documented "1 in 3 hit" rate)
 */
const SV151_HIT_WEIGHTS: Partial<Record<RarityTier, number>> = {
  rare: 669,
  holo_rare: 132,
  ultra_rare: 149,
  secret_rare: 50,
};

const SV151_SOURCE = 'pokepatch.com 2025-05-15, ~1000+ pack community sample';

/**
 * Base Set, 1999. 11 cards: 1 rare, 3 uncommon, 5 common, 2 energy, with
 * roughly one pack in three carrying a holographic rare.
 * Source: Bulbapedia, Base Set (TCG).
 */
const BASE1_HIT_WEIGHTS: Partial<Record<RarityTier, number>> = {
  rare: 667,
  holo_rare: 333,
};

const BASE1_SOURCE = 'Bulbapedia, Base Set (TCG) — 1 in 3 packs holo';

// ───────────────────────────────────────────────────────────────────────────
// Era shapes
// ───────────────────────────────────────────────────────────────────────────

interface EraShape {
  cardsPerPack: number;
  commons: number;
  uncommons: number;
  reverses: number;
  energies: number;
  /** Residual weight distribution for the hit slot, in per-mille. */
  hit: Partial<Record<RarityTier, number>>;
}

/**
 * Pack shapes by era.
 *
 * The card counts are the well-documented structure of each era's boosters.
 * The hit-slot weights are NOT measured data — they are an interpolation of
 * how the rare slot broadened over time (vintage packs were rare-or-holo;
 * modern packs added ultra and secret tiers to the same slot). Every template
 * built from these is tagged 'estimated' for exactly that reason.
 */
const ERA_SHAPES: Record<string, EraShape> = {
  classic:  { cardsPerPack: 11, commons: 5, uncommons: 3, reverses: 0, energies: 2, hit: { rare: 667, holo_rare: 333 } },
  neo:      { cardsPerPack: 11, commons: 5, uncommons: 3, reverses: 0, energies: 2, hit: { rare: 667, holo_rare: 333 } },
  ecard:    { cardsPerPack:  9, commons: 5, uncommons: 3, reverses: 0, energies: 0, hit: { rare: 640, holo_rare: 330, ultra_rare: 30 } },
  ex:       { cardsPerPack:  9, commons: 5, uncommons: 3, reverses: 0, energies: 0, hit: { rare: 600, holo_rare: 310, ultra_rare: 80, secret_rare: 10 } },
  dp:       { cardsPerPack: 10, commons: 4, uncommons: 3, reverses: 1, energies: 0, hit: { rare: 600, holo_rare: 300, ultra_rare: 90, secret_rare: 10 } },
  platinum: { cardsPerPack: 10, commons: 4, uncommons: 3, reverses: 1, energies: 0, hit: { rare: 590, holo_rare: 300, ultra_rare: 100, secret_rare: 10 } },
  hgss:     { cardsPerPack: 10, commons: 4, uncommons: 3, reverses: 1, energies: 0, hit: { rare: 590, holo_rare: 300, ultra_rare: 100, secret_rare: 10 } },
  bw:       { cardsPerPack: 10, commons: 4, uncommons: 3, reverses: 1, energies: 0, hit: { rare: 580, holo_rare: 290, ultra_rare: 115, secret_rare: 15 } },
  xy:       { cardsPerPack: 10, commons: 4, uncommons: 3, reverses: 1, energies: 0, hit: { rare: 570, holo_rare: 280, ultra_rare: 130, secret_rare: 20 } },
  sm:       { cardsPerPack: 10, commons: 4, uncommons: 3, reverses: 1, energies: 0, hit: { rare: 560, holo_rare: 270, ultra_rare: 145, secret_rare: 25 } },
  swsh:     { cardsPerPack: 10, commons: 4, uncommons: 3, reverses: 1, energies: 1, hit: { rare: 550, holo_rare: 260, ultra_rare: 155, secret_rare: 35 } },
  sv:       { cardsPerPack: 10, commons: 4, uncommons: 3, reverses: 1, energies: 1, hit: { rare: 669, holo_rare: 132, ultra_rare: 149, secret_rare: 50 } },
  me:       { cardsPerPack: 10, commons: 4, uncommons: 3, reverses: 1, energies: 1, hit: { rare: 669, holo_rare: 132, ultra_rare: 149, secret_rare: 50 } },
  other:    { cardsPerPack: 10, commons: 4, uncommons: 3, reverses: 1, energies: 0, hit: { rare: 600, holo_rare: 300, ultra_rare: 90, secret_rare: 10 } },
};

const DEFAULT_SHAPE = ERA_SHAPES.other!;

/** Reverse-holo slots draw from the ordinary cards, not from the chase cards. */
const REVERSE_WEIGHTS: Partial<Record<RarityTier, number>> = {
  common: 550,
  uncommon: 350,
  rare: 80,
  holo_rare: 20,
};

/**
 * Build a template and its tables for a set from its era and real composition.
 *
 * Only rarities the set actually contains are given weight, and the residual
 * is redistributed — a 1999 set has no secret rares, so its hit slot must not
 * carry a secret-rare weight that can never resolve.
 */
export function deriveTemplate(set: SetLike, cards: readonly EngineCard[]): DerivedPack {
  const authored = AUTHORED[set.id];
  const shape = ERA_SHAPES[set.era] ?? DEFAULT_SHAPE;

  const present = new Set(cards.map((c) => c.rarityTier));
  const hitWeights = authored?.hit ?? shape.hit;

  const tables: EnginePullTable[] = [];
  const confidence: Confidence = authored ? authored.confidence : 'estimated';
  const source = authored ? authored.source : `derived:${set.era}`;

  const table = (
    name: string,
    rarityWeights: Partial<Record<RarityTier, number>>,
    pool: 'all' | 'reverse_eligible' = 'all',
  ): EnginePullTable => {
    const filtered = restrictToPresent(rarityWeights, present);
    const t: EnginePullTable = {
      id: `${set.id}-${name}`,
      name,
      selectionMode: 'weighted_rarity_pool',
      entries: [],
      rarityWeights: filtered,
      pool,
      confidence,
      source,
      version: 1,
    };
    tables.push(t);
    return t;
  };

  const commonT = table('common', { common: 1 });
  const uncommonT = table('uncommon', { uncommon: 1 });
  const hitT = table('hit', hitWeights);
  const reverseT = shape.reverses > 0 ? table('reverse', REVERSE_WEIGHTS, 'reverse_eligible') : null;
  const energyT = shape.energies > 0 && present.has('energy') ? table('energy', { energy: 1 }) : null;

  const slots: EnginePackTemplate['slots'] = [];
  for (let i = 0; i < shape.commons; i++) {
    slots.push({ name: `common_${i + 1}`, tableId: commonT.id, distinctGroup: 'main' });
  }
  for (let i = 0; i < shape.uncommons; i++) {
    slots.push({ name: `uncommon_${i + 1}`, tableId: uncommonT.id, distinctGroup: 'main' });
  }
  if (reverseT) {
    for (let i = 0; i < shape.reverses; i++) {
      slots.push({
        name: `reverse_holo_${i + 1}`,
        tableId: reverseT.id,
        emphasis: 'reverse',
        distinctGroup: 'reverse',
      });
    }
  }
  slots.push({ name: 'hit', tableId: hitT.id, emphasis: 'hit', distinctGroup: 'hit' });
  if (energyT) {
    for (let i = 0; i < shape.energies; i++) {
      slots.push({ name: `energy_${i + 1}`, tableId: energyT.id, distinctGroup: 'energy' });
    }
  }

  const template: EnginePackTemplate = {
    id: `${set.id}-booster`,
    setId: set.id,
    name: `${set.name} Booster Pack`,
    productType: 'booster_pack',
    cardsPerPack: slots.length,
    slots,
    confidence,
    source,
    version: 1,
  };

  return { template, tables };
}

/** Drop rarities the set does not contain, so no weight is unreachable. */
function restrictToPresent(
  weights: Partial<Record<RarityTier, number>>,
  present: ReadonlySet<RarityTier>,
): Partial<Record<RarityTier, number>> {
  const out: Partial<Record<RarityTier, number>> = {};
  for (const [tier, w] of Object.entries(weights)) {
    if ((w ?? 0) > 0 && present.has(tier as RarityTier)) out[tier as RarityTier] = w;
  }
  // If nothing survived (a promo-only set with no 'rare' at all), fall back to
  // whatever the set does have, so the slot can still produce a card.
  if (Object.keys(out).length === 0) {
    for (const tier of present) out[tier] = 1;
  }
  return out;
}

interface Authored {
  hit: Partial<Record<RarityTier, number>>;
  confidence: Confidence;
  source: string;
}

/** Sets whose hit-slot rates come from a real, citable measurement. */
export const AUTHORED: Record<string, Authored> = {
  sv3pt5: { hit: SV151_HIT_WEIGHTS, confidence: 'documented_community_data', source: SV151_SOURCE },
  base1: { hit: BASE1_HIT_WEIGHTS, confidence: 'documented_community_data', source: BASE1_SOURCE },
};

export const isAuthored = (setId: string): boolean => setId in AUTHORED;

/**
 * Reverse-holo printings only exist from the EX era onward, and never for the
 * chase rarities. Importers use this to populate `reverseEligible`.
 */
export function isReverseEligible(era: string, tier: RarityTier): boolean {
  const REVERSE_ERAS = new Set([
    'ex', 'dp', 'platinum', 'hgss', 'bw', 'xy', 'sm', 'swsh', 'sv', 'me', 'other',
  ]);
  if (!REVERSE_ERAS.has(era)) return false;
  return tier === 'common' || tier === 'uncommon' || tier === 'rare' || tier === 'holo_rare';
}
