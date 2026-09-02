import type { Cents, Condition, RarityTier } from '@pcs/shared';

export interface NpcStock {
  id: string;
  shopId: string;
  cardId: string;
  name: string;
  number: string;
  setName: string;
  rarityTier: RarityTier;
  imageSmall: string | null;
  imageLarge: string | null;
  condition: Condition;
  conditionLabel: string;
  grade: { company: string; numericGrade: number; label: string; isBlackLabel: boolean } | null;
  marketValue: Cents;
  askPrice: Cents;
  priceConfidence: string;
  demandBand: string;
  isNew: boolean;
}

export interface Dealer {
  id: string;
  name: string;
  shopName: string;
  monogram: string;
  specialty: string;
  note: string;
  refreshHours: number;
  refreshAt: string;
  stock: NpcStock[];
  emptySlots: number;
}

export interface TradeCard {
  inventoryId: string;
  cardId: string;
  name: string;
  setName: string;
  imageSmall: string | null;
  condition: Condition;
  grade: { company: string; numericGrade: number; label: string; isBlackLabel: boolean } | null;
  marketValue: Cents;
  credit: Cents;
  exactWishlist: boolean;
  favorite: boolean;
}

export interface NpcMarketData {
  serverTime: string;
  dealers: Dealer[];
  activity: Array<{
    id: string;
    shopId: string;
    status: string;
    name: string;
    gradeCompany: string | null;
    numericGrade: number | null;
    resolvedAt: string | null;
  }>;
}

export interface PlayerListing {
  id: string; inventoryItemId: string; cardId: string; name: string; number: string;
  rarityTier: string; imageSmall: string | null; setName: string;
  askPrice: number; marketValue: number; ratioBp: number;
  outlook: string; outlookLabel: string; expectedSeconds: number;
  visits: number; listedAt: string; dealerAlternative: number; netIfSold: number;
}

export interface PlayerSale {
  id: string; name: string; imageSmall: string | null;
  soldPrice: number; feePaid: number; netProceeds: number; marketValue: number;
  buyerName: string | null; buyerNote: string | null; soldAt: string; visits: number;
}
