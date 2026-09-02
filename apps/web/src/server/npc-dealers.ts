import { bp, type Bp } from '@pcs/economy-engine';
import type { RarityTier } from '@pcs/shared';

export interface DealerProfile {
  id: string;
  name: string;
  shopName: string;
  monogram: string;
  specialty: string;
  note: string;
  refreshHours: number;
  trafficBp: Bp;
  markupBp: readonly [number, number];
  floorBp: readonly [number, number];
  tradeCreditBp: Bp;
  temperamentBase: number;
  repetitionPenalty: number;
  gradedChance: number;
  eras: readonly string[];
  rarityTiers: readonly RarityTier[];
}

export const DEALERS: readonly DealerProfile[] = [
  {
    id: 'mina-modern',
    name: 'Mina',
    shopName: 'Modern pulls',
    monogram: 'MI',
    specialty: 'Fresh illustration rares and modern chase cards',
    note: 'Fast counter, fast decisions. Mina knows what is moving today.',
    refreshHours: 3,
    trafficBp: bp(12_000),
    markupBp: [10_300, 11_800],
    floorBp: [8_700, 9_700],
    tradeCreditBp: bp(8_500),
    temperamentBase: 9,
    repetitionPenalty: 11,
    gradedChance: 0.08,
    eras: ['swsh', 'sv', 'me'],
    rarityTiers: ['rare', 'holo_rare', 'ultra_rare', 'secret_rare', 'promo'],
  },
  {
    id: 'rory-binder',
    name: 'Rory',
    shopName: 'Binder table',
    monogram: 'RO',
    specialty: 'Collectible cards from every era, with room to bargain',
    note: 'Rory would rather make a fair trade than guard a price sticker.',
    refreshHours: 5,
    trafficBp: bp(10_000),
    markupBp: [10_500, 12_000],
    floorBp: [8_600, 9_500],
    tradeCreditBp: bp(9_000),
    temperamentBase: 4,
    repetitionPenalty: 7,
    gradedChance: 0.12,
    eras: [],
    rarityTiers: ['rare', 'holo_rare', 'ultra_rare', 'secret_rare', 'promo'],
  },
  {
    id: 'jules-slabs',
    name: 'Jules',
    shopName: 'The slab case',
    monogram: 'JU',
    specialty: 'Authenticated grades and statement cards',
    note: 'The number on the label matters. So does the number on the offer.',
    refreshHours: 7,
    trafficBp: bp(10_500),
    markupBp: [11_000, 13_200],
    floorBp: [9_300, 10_100],
    tradeCreditBp: bp(8_000),
    temperamentBase: 8,
    repetitionPenalty: 12,
    gradedChance: 1,
    eras: [],
    rarityTiers: ['holo_rare', 'ultra_rare', 'secret_rare', 'promo'],
  },
  {
    id: 'old-oak-vintage',
    name: 'Old Oak',
    shopName: 'Vintage cabinet',
    monogram: 'OO',
    specialty: 'Older printings, scarce holos and patient deals',
    note: 'The cabinet opens slowly. The good cards leave the same way.',
    refreshHours: 9,
    trafficBp: bp(8_000),
    markupBp: [10_800, 12_800],
    floorBp: [9_000, 9_900],
    tradeCreditBp: bp(8_800),
    temperamentBase: 3,
    repetitionPenalty: 6,
    gradedChance: 0.28,
    eras: ['classic', 'neo', 'ecard', 'ex', 'dp', 'platinum', 'hgss'],
    rarityTiers: ['rare', 'holo_rare', 'ultra_rare', 'secret_rare', 'promo'],
  },
] as const;

export function dealerById(id: string): DealerProfile {
  const dealer = DEALERS.find((candidate) => candidate.id === id);
  if (!dealer) throw new Error(`Unknown NPC dealer: ${id}`);
  return dealer;
}
