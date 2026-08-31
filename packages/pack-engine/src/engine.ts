import { isHit as rarityIsHit, type RarityTier } from '../../shared/src/index';
import { makeRng, hashSeed, weightedPick, type Rng } from './rng';
import type {
  EngineCard, EnginePackTemplate, EnginePullTable, OpeningResult, PulledCard,
} from './types';

/**
 * The pack simulator.
 *
 * Pure by construction: it takes a template, its tables and the candidate card
 * pool, and returns a result. It performs no I/O, touches no database and
 * knows nothing about money or React. The caller loads the data and persists
 * the outcome.
 *
 * Given the same seed and the same template version, the output is identical.
 */

export class PackEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackEngineError';
  }
}

export interface OpenPackInput {
  template: EnginePackTemplate;
  tables: readonly EnginePullTable[];
  cards: readonly EngineCard[];
  seed: string;
}

export function openPack({ template, tables, cards, seed }: OpenPackInput): OpeningResult {
  if (template.slots.length === 0) {
    throw new PackEngineError(`Template ${template.id} has no slots`);
  }

  const rng = makeRng(seed);
  const tableById = new Map(tables.map((t) => [t.id, t]));
  const cardById = new Map(cards.map((c) => [c.id, c]));

  // Rarity-pool tables select from the set's real composition, so index once
  // rather than filtering the whole set per slot.
  const byRarity = new Map<RarityTier, EngineCard[]>();
  const byRarityReverse = new Map<RarityTier, EngineCard[]>();
  for (const c of cards) {
    (byRarity.get(c.rarityTier) ?? byRarity.set(c.rarityTier, []).get(c.rarityTier)!).push(c);
    if (c.reverseEligible) {
      (byRarityReverse.get(c.rarityTier) ??
        byRarityReverse.set(c.rarityTier, []).get(c.rarityTier)!).push(c);
    }
  }

  const pulled: PulledCard[] = [];
  /**
   * Cards already used, per distinct-group, so a pack cannot show the same
   * card twice in two commons slots.
   *
   * Reverse-holo slots form their own group deliberately. Pulling a card as
   * both a regular and a reverse holo in one pack is a real occurrence, and
   * the two are distinct collectables with different market values — so they
   * are not treated as a duplicate. Uniqueness holds per printing, not per
   * card id.
   */
  const usedByGroup = new Map<string, Set<string>>();

  for (const [slotIndex, slot] of template.slots.entries()) {
    const table = tableById.get(slot.tableId);
    if (!table) {
      throw new PackEngineError(
        `Slot "${slot.name}" of template ${template.id} references missing table ${slot.tableId}`,
      );
    }

    const group = slot.distinctGroup ?? slot.name;
    const used = usedByGroup.get(group) ?? usedByGroup.set(group, new Set()).get(group)!;

    const card = selectForSlot({ table, rng, cardById, byRarity, byRarityReverse, used });

    used.add(card.id);
    pulled.push({
      cardId: card.id,
      slotName: slot.name,
      slotIndex,
      rarityTier: card.rarityTier,
      isHit: rarityIsHit(card.rarityTier),
      isReverse: slot.emphasis === 'reverse',
    });
  }

  return {
    packTemplateId: template.id,
    templateVersion: template.version,
    setId: template.setId,
    cards: pulled,
    seedHash: hashSeed(seed),
  };
}

interface SelectArgs {
  table: EnginePullTable;
  rng: Rng;
  cardById: Map<string, EngineCard>;
  byRarity: Map<RarityTier, EngineCard[]>;
  byRarityReverse: Map<RarityTier, EngineCard[]>;
  used: Set<string>;
}

/**
 * Resolve one slot to one card.
 *
 * Avoiding duplicates uses bounded retries rather than rebuilding a filtered
 * pool per attempt: the pools are large, collisions are rare, and rebuilding
 * would dominate the cost of a 100k-opening simulation. When retries run out
 * (a genuinely tiny pool), we fall back to a deterministic scan so the slot
 * still yields a card instead of throwing.
 */
function selectForSlot(args: SelectArgs): EngineCard {
  const { table, rng, used } = args;
  const MAX_TRIES = 24;

  for (let i = 0; i < MAX_TRIES; i++) {
    const card = selectOnce(args);
    if (!used.has(card.id)) return card;
  }

  const pool = candidatePool(args);
  const fresh = pool.find((c) => !used.has(c.id));
  if (fresh) return fresh;

  // The pool is genuinely exhausted (a set with fewer distinct cards of this
  // rarity than the pack has slots for it). Repeating is the correct answer.
  const any = pool[0];
  if (!any) {
    throw new PackEngineError(`Pull table ${table.id} produced no candidates`);
  }
  return any;
}

function selectOnce(args: SelectArgs): EngineCard {
  const { table, rng, cardById } = args;

  if (table.selectionMode === 'weighted_card_pool') {
    if (table.entries.length === 0) {
      throw new PackEngineError(`Pull table ${table.id} has no entries`);
    }
    const entry = weightedPick(table.entries, rng);
    const card = cardById.get(entry.cardId);
    if (!card) {
      throw new PackEngineError(`Pull table ${table.id} references unknown card ${entry.cardId}`);
    }
    return card;
  }

  // weighted_rarity_pool: pick a tier by weight, then a card uniformly within it.
  const index = table.pool === 'reverse_eligible' ? args.byRarityReverse : args.byRarity;
  const weights = table.rarityWeights ?? {};

  const available = Object.entries(weights)
    .filter(([tier, w]) => (w ?? 0) > 0 && (index.get(tier as RarityTier)?.length ?? 0) > 0)
    .map(([tier, w]) => ({ tier: tier as RarityTier, weight: w as number }));

  if (available.length === 0) {
    throw new PackEngineError(
      `Pull table ${table.id} has no rarity with both weight and cards available`,
    );
  }

  const tier = weightedPick(available, rng).tier;
  const pool = index.get(tier)!;
  const card = pool[Math.floor(rng() * pool.length)];
  if (!card) throw new PackEngineError(`Empty pool for rarity ${tier} in table ${table.id}`);
  return card;
}

/** Every card a table could yield. Used only on the slow fallback path. */
function candidatePool(args: SelectArgs): EngineCard[] {
  const { table, cardById } = args;
  if (table.selectionMode === 'weighted_card_pool') {
    return table.entries
      .filter((e) => e.weight > 0)
      .map((e) => cardById.get(e.cardId))
      .filter((c): c is EngineCard => Boolean(c));
  }
  const index = table.pool === 'reverse_eligible' ? args.byRarityReverse : args.byRarity;
  const out: EngineCard[] = [];
  for (const [tier, w] of Object.entries(table.rarityWeights ?? {})) {
    if ((w ?? 0) > 0) out.push(...(index.get(tier as RarityTier) ?? []));
  }
  return out;
}

/**
 * Expected value of one pack, weighted by the template's real slot structure.
 *
 * Prices are injected as a lookup rather than imported, so the engine stays
 * free of the economy layer and of any database.
 *
 * The subtlety this exists to get right: a slot's candidate pool is not simply
 * "every card of these rarities". A reverse-holo slot draws only from
 * reverse-eligible cards, and those are not priced like the tier as a whole.
 * Averaging over the full tier understated reverse slots enough to make one
 * set profitable to spam-open, which is exactly the failure DESIGN.md section
 * 30 warns about.
 */
export function expectedPackValue(
  template: EnginePackTemplate,
  tables: readonly EnginePullTable[],
  cards: readonly EngineCard[],
  priceOf: (cardId: string) => number,
): number {
  const tableById = new Map(tables.map((t) => [t.id, t]));

  // Average price per rarity, computed separately for each candidate pool.
  const meanFor = (tier: RarityTier, pool: 'all' | 'reverse_eligible'): number => {
    let sum = 0;
    let n = 0;
    for (const c of cards) {
      if (c.rarityTier !== tier) continue;
      if (pool === 'reverse_eligible' && !c.reverseEligible) continue;
      sum += priceOf(c.id);
      n++;
    }
    return n === 0 ? 0 : sum / n;
  };

  const cache = new Map<string, number>();
  const meanCached = (tier: RarityTier, pool: 'all' | 'reverse_eligible') => {
    const key = `${tier}:${pool}`;
    let v = cache.get(key);
    if (v === undefined) {
      v = meanFor(tier, pool);
      cache.set(key, v);
    }
    return v;
  };

  let total = 0;
  for (const slot of template.slots) {
    const table = tableById.get(slot.tableId);
    if (!table) continue;

    if (table.selectionMode === 'weighted_card_pool') {
      const weightTotal = table.entries.reduce((a, e) => a + Math.max(0, e.weight), 0);
      if (weightTotal <= 0) continue;
      for (const e of table.entries) {
        if (e.weight <= 0) continue;
        total += (e.weight / weightTotal) * priceOf(e.cardId);
      }
      continue;
    }

    const pool = table.pool === 'reverse_eligible' ? 'reverse_eligible' : 'all';
    const weights = Object.entries(table.rarityWeights ?? {}) as [RarityTier, number][];

    // Only rarities the pool can actually produce carry weight, matching how
    // selectOnce filters at open time.
    const live = weights.filter(
      ([tier, w]) => (w ?? 0) > 0 && meanCached(tier, pool) >= 0 &&
        cards.some((c) => c.rarityTier === tier && (pool === 'all' || c.reverseEligible)),
    );
    const weightTotal = live.reduce((a, [, w]) => a + (w ?? 0), 0);
    if (weightTotal <= 0) continue;

    for (const [tier, w] of live) {
      total += ((w ?? 0) / weightTotal) * meanCached(tier, pool);
    }
  }

  return total;
}
