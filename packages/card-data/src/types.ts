import type { Cents, Confidence, Era, RarityTier } from '../../shared/src/index.js';

/** A `sets` row as the app sees it, plus derived counts where requested. */
export interface SetRecord {
  id: string;
  name: string;
  series: string;
  era: Era;
  releaseDate: string;
  printedTotal: number;
  total: number;
  logoUrl: string | null;
  symbolUrl: string | null;
  /** Cards actually present in our catalogue. Only populated when requested. */
  cardCount?: number;
}

/** A `cards` row as the app sees it. */
export interface CardRecord {
  id: string;
  setId: string;
  number: string;
  name: string;
  rarityRaw: string | null;
  rarityTier: RarityTier;
  supertype: string | null;
  subtypes: string[];
  types: string[];
  artist: string | null;
  imageSmall: string | null;
  imageLarge: string | null;
  marketBasePrice: Cents | null;
  priceConfidence: Confidence;
}

export interface CardWithSet extends CardRecord {
  set: SetRecord;
}

export type SetSortKey = 'releaseDate' | 'name' | 'cardCount';
export type CardSortKey = 'number' | 'name' | 'rarity' | 'price';
export type SortDirection = 'asc' | 'desc';

export interface ListSetsFilter {
  era?: Era | Era[];
  series?: string | string[];
  /** Case-insensitive substring match on set name, series or id. */
  search?: string;
  /** ISO `YYYY-MM-DD`, inclusive. */
  releasedFrom?: string;
  releasedTo?: string;
  /** Adds `cardCount` to every row. Costs one extra grouped scan. */
  withCounts?: boolean;
  /** Drop sets we imported no cards for. Implies `withCounts`. */
  nonEmptyOnly?: boolean;
  sort?: SetSortKey;
  direction?: SortDirection;
}

export interface ListCardsFilter {
  setId?: string | string[];
  rarityTier?: RarityTier | RarityTier[];
  /** Case-insensitive substring match on card name. */
  search?: string;
  /** Only cards we hold a real baseline price for. */
  pricedOnly?: boolean;
  sort?: CardSortKey;
  direction?: SortDirection;
  /** 1-based. */
  page?: number;
  pageSize?: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface RarityCompletion {
  rarityTier: RarityTier;
  total: number;
  owned: number;
}

export interface SetCompletion {
  setId: string;
  setName: string;
  /** Distinct cards in the set that exist in our catalogue. */
  totalCards: number;
  /** Distinct cards of the set the player holds at least one copy of. */
  ownedCards: number;
  /** Total physical copies held, including duplicates. */
  ownedCopies: number;
  /** Completion in basis points (10000 = 100%), so no float creeps in. */
  completionBp: number;
  byRarity: RarityCompletion[];
}

export const DEFAULT_PAGE_SIZE = 60;
export const MAX_PAGE_SIZE = 250;
