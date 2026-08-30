import type { Cents } from './money.js';
import type { Confidence } from './confidence.js';
import type { RarityTier } from './rarity.js';

// ---------------------------------------------------------------------------
// Real-world data layer (design doc section 2). Nothing here knows about a
// player, a balance or a game rule.
// ---------------------------------------------------------------------------

/** Broad release era. Drives default pack structure when a set has no authored template. */
export const ERAS = [
  'classic', 'neo', 'ecard', 'ex', 'dp', 'platinum', 'hgss',
  'bw', 'xy', 'sm', 'swsh', 'sv', 'me', 'other',
] as const;
export type Era = (typeof ERAS)[number];

export interface CardSet {
  id: string;
  name: string;
  series: string;
  era: Era;
  releaseDate: string;
  printedTotal: number;
  total: number;
  logoUrl: string | null;
  symbolUrl: string | null;
}

export interface Card {
  id: string;
  setId: string;
  number: string;
  name: string;
  /** Original source string, kept for display and re-normalization. */
  rarityRaw: string | null;
  rarityTier: RarityTier;
  supertype: string | null;
  subtypes: string[];
  artist: string | null;
  imageSmall: string | null;
  imageLarge: string | null;
  /** Baseline market price. Null when no price source covers this card. */
  marketBasePrice: Cents | null;
  priceConfidence: Confidence;
}

// ---------------------------------------------------------------------------
// Pack simulation (design doc section 5)
// ---------------------------------------------------------------------------

export interface PullTableEntry {
  cardId: string;
  weight: number;
}

export type SelectionMode = 'weighted_card_pool' | 'weighted_rarity_pool';

export interface PullTable {
  id: string;
  name: string;
  selectionMode: SelectionMode;
  entries: PullTableEntry[];
  /** Used when selectionMode is weighted_rarity_pool. */
  rarityWeights?: Partial<Record<RarityTier, number>>;
  confidence: Confidence;
  source: string;
  version: number;
}

export interface PackSlot {
  name: string;
  tableId: string;
  /** A reverse-holo or hit slot is revealed with more ceremony. */
  emphasis?: 'none' | 'reverse' | 'hit';
}

export interface PackTemplate {
  id: string;
  setId: string;
  name: string;
  cardsPerPack: number;
  slots: PackSlot[];
  confidence: Confidence;
  source: string;
  version: number;
}

/** One card produced by one slot of one opening. */
export interface PulledCard {
  cardId: string;
  slotName: string;
  rarityTier: RarityTier;
  isHit: boolean;
}

export interface OpeningResult {
  openingId: string;
  packTemplateId: string;
  templateVersion: number;
  cards: PulledCard[];
  /** Hash of the server seed, published so an opening can be audited later. */
  seedHash: string;
}

// ---------------------------------------------------------------------------
// Game layer (design doc section 2)
// ---------------------------------------------------------------------------

export const CONDITIONS = [
  'near_mint', 'lightly_played', 'moderately_played', 'heavily_played', 'damaged',
] as const;
export type Condition = (typeof CONDITIONS)[number];

export const CONDITION_LABEL: Record<Condition, string> = {
  near_mint: 'Near Mint',
  lightly_played: 'Lightly Played',
  moderately_played: 'Moderately Played',
  heavily_played: 'Heavily Played',
  damaged: 'Damaged',
};

export type AcquisitionSource = 'pack' | 'market' | 'starter' | 'reward' | 'trade';
export type InventoryStatus = 'owned' | 'listed' | 'grading' | 'sold';

export interface InventoryCard {
  inventoryId: string;
  cardId: string;
  condition: Condition;
  acquisitionSource: AcquisitionSource;
  acquisitionPrice: Cents;
  acquiredAt: string;
  status: InventoryStatus;
  gradingId: string | null;
}
