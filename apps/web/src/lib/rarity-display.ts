import {
  CONFIDENCE_LABEL,
  RARITY_RANK,
  type Confidence,
  type RarityTier,
} from "@pcs/shared";

/**
 * §32: "colour-independent rarity indicators".
 *
 * The Pokémon TCG already solved this in print — every card carries a rarity
 * symbol in its bottom corner: a filled circle for common, a diamond for
 * uncommon, a star for rare. We extend that printed vocabulary rather than
 * inventing badges, so the shape alone identifies the tier with no colour and
 * no text, and the vocabulary is one a collector already reads fluently.
 */
export type RaritySymbolKind =
  | "circle" // ● common
  | "diamond" // ◆ uncommon
  | "star" // ★ rare
  | "star-holo" // ★ inside a hexagon — holo
  | "double-star" // ★★ — ultra
  | "burst" // eight-point burst — secret
  | "seal" // rosette — promo
  | "bolt" // energy
  | "question"; // unknown

export interface RarityDisplay {
  tier: RarityTier;
  /** Short label. Never the only signal, but always present. */
  label: string;
  symbol: RaritySymbolKind;
  /** Foil strength 0..1 fed to the .foil-* layers. */
  foil: number;
  /** Words for the effect, for screen readers and for reduced motion. §32. */
  effect: string;
}

export const RARITY_DISPLAY: Record<RarityTier, RarityDisplay> = {
  energy: {
    tier: "energy",
    label: "Energy",
    symbol: "bolt",
    foil: 0,
    effect: "no shine",
  },
  common: {
    tier: "common",
    label: "Common",
    symbol: "circle",
    foil: 0,
    effect: "no shine",
  },
  uncommon: {
    tier: "uncommon",
    label: "Uncommon",
    symbol: "diamond",
    foil: 0,
    effect: "no shine",
  },
  rare: {
    tier: "rare",
    label: "Rare",
    symbol: "star",
    foil: 0.14,
    effect: "a faint gloss across the card",
  },
  holo_rare: {
    tier: "holo_rare",
    label: "Holo Rare",
    symbol: "star-holo",
    foil: 0.62,
    effect: "a rainbow holo sheen that moves with the card",
  },
  ultra_rare: {
    tier: "ultra_rare",
    label: "Ultra Rare",
    symbol: "double-star",
    foil: 0.85,
    effect: "a full-art foil that flares as the card turns",
  },
  secret_rare: {
    tier: "secret_rare",
    label: "Secret Rare",
    symbol: "burst",
    foil: 1,
    effect: "a gold rainbow foil with a burst of light",
  },
  promo: {
    tier: "promo",
    label: "Promo",
    symbol: "seal",
    foil: 0.3,
    effect: "a black-star promo gloss",
  },
  unknown: {
    tier: "unknown",
    label: "Unclassified",
    symbol: "question",
    foil: 0,
    effect: "no shine",
  },
};

export const rarityDisplay = (t: RarityTier) => RARITY_DISPLAY[t];

export const rarityRank = (t: RarityTier) => RARITY_RANK[t];

/**
 * CLAUDE.md non-negotiable 3 / DESIGN.md §5. The UI is only allowed to speak in
 * exact percentages when the source supports it; everything else is hedged in
 * the words `CONFIDENCE_LABEL` chose.
 */
export function rateSentence(rate: number, confidence: Confidence): string {
  const label = CONFIDENCE_LABEL[confidence];
  if (confidence === "official" || confidence === "manufacturer_published") {
    return `${label}: ${(rate * 100).toFixed(2)}%`;
  }
  if (confidence === "unknown") return label;
  return `${label}: about 1 in ${Math.round(1 / rate)}`;
}
