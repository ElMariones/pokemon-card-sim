import { describe, it, expect } from 'vitest';
import { openPack, PackEngineError } from './engine';
import { deriveTemplate, isReverseEligible } from './templates';
import type { EngineCard, EnginePullTable, EnginePackTemplate } from './types';
import type { RarityTier } from '../../shared/src/index';

/** A synthetic set with a realistic rarity spread. */
function makeCards(setId: string, era: string): EngineCard[] {
  const spec: [RarityTier, number][] = [
    ['common', 80], ['uncommon', 60], ['rare', 30],
    ['holo_rare', 20], ['ultra_rare', 15], ['secret_rare', 8], ['energy', 6],
  ];
  const out: EngineCard[] = [];
  let n = 1;
  for (const [tier, count] of spec) {
    for (let i = 0; i < count; i++) {
      out.push({
        id: `${setId}-${n}`, setId, number: String(n), rarityTier: tier,
        reverseEligible: isReverseEligible(era, tier),
      });
      n++;
    }
  }
  return out;
}

const SET = { id: 'test1', era: 'sv', name: 'Test Set' };
const CARDS = makeCards('test1', 'sv');
const { template, tables } = deriveTemplate(SET, CARDS);

describe('openPack', () => {
  it('is deterministic for a given seed', () => {
    const a = openPack({ template, tables, cards: CARDS, seed: 'fixed-seed' });
    const b = openPack({ template, tables, cards: CARDS, seed: 'fixed-seed' });
    expect(a).toEqual(b);
  });

  it('produces different packs for different seeds', () => {
    const a = openPack({ template, tables, cards: CARDS, seed: 'seed-1' });
    const b = openPack({ template, tables, cards: CARDS, seed: 'seed-2' });
    expect(a.cards.map((c) => c.cardId)).not.toEqual(b.cards.map((c) => c.cardId));
  });

  it('fills exactly one card per slot', () => {
    for (let i = 0; i < 500; i++) {
      const r = openPack({ template, tables, cards: CARDS, seed: `s${i}` });
      expect(r.cards).toHaveLength(template.slots.length);
      expect(r.cards).toHaveLength(template.cardsPerPack);
      expect(r.cards.map((c) => c.slotName)).toEqual(template.slots.map((s) => s.name));
    }
  });

  /**
   * Uniqueness is per *printing*, not per card id.
   *
   * Pulling Pikachu as a common and Pikachu as a reverse holo in the same pack
   * is a real thing that happens, and the two are distinct collectables with
   * different market values. Measured over 5,000 synthetic packs, 100% of
   * same-id repeats involved the reverse slot and none occurred anywhere else.
   */
  it('never repeats the same printing within one pack', () => {
    for (let i = 0; i < 5_000; i++) {
      const r = openPack({ template, tables, cards: CARDS, seed: `dup-${i}` });
      const printings = r.cards.map((c) => `${c.cardId}:${c.isReverse ? 'rev' : 'std'}`);
      expect(new Set(printings).size, `pack ${i} repeated a printing`).toBe(printings.length);
    }
  });

  it('repeats a card id only ever across the reverse boundary', () => {
    for (let i = 0; i < 5_000; i++) {
      const r = openPack({ template, tables, cards: CARDS, seed: `dup-${i}` });
      const byId = new Map<string, boolean[]>();
      for (const c of r.cards) {
        (byId.get(c.cardId) ?? byId.set(c.cardId, []).get(c.cardId)!).push(c.isReverse);
      }
      for (const [id, reverseFlags] of byId) {
        if (reverseFlags.length > 1) {
          // Exactly one of the repeats must be the reverse printing.
          expect(reverseFlags.filter(Boolean), `${id} repeated outside reverse`).toHaveLength(1);
        }
      }
    }
  });

  it('publishes a seed hash without revealing the seed', () => {
    const r = openPack({ template, tables, cards: CARDS, seed: 'my-secret' });
    expect(r.seedHash).toHaveLength(64);
    expect(r.seedHash).not.toContain('my-secret');
  });

  it('draws each slot from the rarity its table declares', () => {
    for (let i = 0; i < 300; i++) {
      const r = openPack({ template, tables, cards: CARDS, seed: `slots-${i}` });
      for (const c of r.cards) {
        if (c.slotName.startsWith('common_')) expect(c.rarityTier).toBe('common');
        if (c.slotName.startsWith('uncommon_')) expect(c.rarityTier).toBe('uncommon');
        if (c.slotName.startsWith('energy_')) expect(c.rarityTier).toBe('energy');
      }
    }
  });

  it('only ever puts reverse-eligible cards in a reverse slot', () => {
    const eligible = new Set(CARDS.filter((c) => c.reverseEligible).map((c) => c.id));
    for (let i = 0; i < 2_000; i++) {
      const r = openPack({ template, tables, cards: CARDS, seed: `rev-${i}` });
      for (const c of r.cards.filter((c) => c.isReverse)) {
        expect(eligible.has(c.cardId)).toBe(true);
      }
    }
  });
});

describe('openPack failure modes', () => {
  const bad = (t: Partial<EnginePackTemplate>): EnginePackTemplate =>
    ({ ...template, ...t }) as EnginePackTemplate;

  it('throws when a slot references a table that does not exist', () => {
    const t = bad({ slots: [{ name: 'x', tableId: 'nope' }] });
    expect(() => openPack({ template: t, tables, cards: CARDS, seed: 's' }))
      .toThrow(PackEngineError);
  });

  it('throws on a template with no slots rather than returning an empty pack', () => {
    expect(() => openPack({ template: bad({ slots: [] }), tables, cards: CARDS, seed: 's' }))
      .toThrow(/no slots/i);
  });

  it('throws when a card-pool table is empty', () => {
    const empty: EnginePullTable = {
      id: 'empty', name: 'empty', selectionMode: 'weighted_card_pool',
      entries: [], confidence: 'estimated', source: 'test', version: 1,
    };
    const t = bad({ slots: [{ name: 'x', tableId: 'empty' }] });
    expect(() => openPack({ template: t, tables: [empty], cards: CARDS, seed: 's' }))
      .toThrow(/no entries/i);
  });
});

describe('deriveTemplate', () => {
  it('gives 151 the measured community rates, not an estimate', () => {
    const { template: t, tables: tb } = deriveTemplate(
      { id: 'sv3pt5', era: 'sv', name: '151' }, makeCards('sv3pt5', 'sv'),
    );
    expect(t.confidence).toBe('documented_community_data');
    expect(t.source).toContain('pokepatch');
    const hit = tb.find((x) => x.name === 'hit')!;
    // 13.2% Double Rare, per the cited sample.
    expect(hit.rarityWeights?.holo_rare).toBe(132);
  });

  it('marks derived templates as estimated', () => {
    const { template: t } = deriveTemplate({ id: 'xy7', era: 'xy', name: 'X' }, makeCards('xy7', 'xy'));
    expect(t.confidence).toBe('estimated');
    expect(t.source).toBe('derived:xy');
  });

  it('never gives weight to a rarity the set does not contain', () => {
    // A vintage set with no ultra or secret rares.
    const vintage: EngineCard[] = [
      ...Array.from({ length: 40 }, (_, i) => ({
        id: `v-c${i}`, setId: 'v', number: String(i), rarityTier: 'common' as RarityTier,
      })),
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `v-u${i}`, setId: 'v', number: `u${i}`, rarityTier: 'uncommon' as RarityTier,
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `v-r${i}`, setId: 'v', number: `r${i}`, rarityTier: 'rare' as RarityTier,
      })),
    ];
    const { template: t, tables: tb } = deriveTemplate(
      { id: 'v', era: 'classic', name: 'Vintage' }, vintage,
    );
    const hit = tb.find((x) => x.name === 'hit')!;
    expect(hit.rarityWeights?.ultra_rare).toBeUndefined();
    expect(hit.rarityWeights?.secret_rare).toBeUndefined();

    // And it must still open without error.
    for (let i = 0; i < 200; i++) {
      const r = openPack({ template: t, tables: tb, cards: vintage, seed: `v${i}` });
      expect(r.cards.length).toBeGreaterThan(0);
    }
  });

  it('omits the reverse slot for pre-reverse-holo eras', () => {
    const { template: t } = deriveTemplate(
      { id: 'base1', era: 'classic', name: 'Base' }, makeCards('base1', 'classic'),
    );
    expect(t.slots.some((s) => s.emphasis === 'reverse')).toBe(false);
  });
});
