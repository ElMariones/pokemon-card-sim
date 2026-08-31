import type { Confidence, RarityTier } from '../../shared/src/index.js';

/** A card as the engine sees it. Deliberately minimal: no prices, no images. */
export interface EngineCard {
  id: string;
  setId: string;
  number: string;
  rarityTier: RarityTier;
  /**
   * Whether this card exists as a reverse-holo printing. Most commons and
   * uncommons in the reverse-holo era do; secret rares never do.
   */
  reverseEligible?: boolean;
}

export interface PullEntry {
  cardId: string;
  weight: number;
}

export type SelectionMode = 'weighted_card_pool' | 'weighted_rarity_pool';

export interface EnginePullTable {
  id: string;
  name: string;
  selectionMode: SelectionMode;
  /** Used when selectionMode is 'weighted_card_pool'. */
  entries: PullEntry[];
  /** Used when selectionMode is 'weighted_rarity_pool'. */
  rarityWeights?: Partial<Record<RarityTier, number>>;
  /** Restricts a rarity-pool table to a subset of the set (e.g. reverse-eligible only). */
  pool?: 'all' | 'reverse_eligible';
  confidence: Confidence;
  source: string;
  version: number;
}

export interface EnginePackSlot {
  name: string;
  tableId: string;
  emphasis?: 'none' | 'reverse' | 'hit';
  /** Slots sharing a group never repeat a card between them. */
  distinctGroup?: string;
}

export interface EnginePackTemplate {
  id: string;
  setId: string;
  name: string;
  productType: string;
  cardsPerPack: number;
  slots: EnginePackSlot[];
  confidence: Confidence;
  source: string;
  version: number;
}

export interface PulledCard {
  cardId: string;
  slotName: string;
  slotIndex: number;
  rarityTier: RarityTier;
  isHit: boolean;
  /** True when the card was produced by a reverse-holo slot. */
  isReverse: boolean;
}

export interface OpeningResult {
  packTemplateId: string;
  templateVersion: number;
  setId: string;
  cards: PulledCard[];
  seedHash: string;
}
