/**
 * The tcgcsv.com mirror of TCGplayer's own price feed.
 *
 * This is the same upstream that api.pokemontcg.io republishes, one day fresh
 * and one request per set. Two things it has that the API does not: the 2026
 * sets (the API ships their cards with no price block at all), and sealed
 * products — booster packs, boxes, ETBs — which is what pack pricing needs.
 *
 * Nothing here decides what a card is worth. Rows are adapted into the shape
 * `selectBasePrice` already consumes so that both sources go through one price
 * policy; a second policy here is exactly how two "market prices" that mean
 * different things end up in the same column.
 */
import type { PriceSourceCard, TcgPlayerVariantPrices } from './price-selection';

export interface TcgcsvProduct {
  productId: number;
  name: string;
  url?: string | null;
  extendedData?: readonly { name: string; value: string }[];
}

export interface TcgcsvPrice {
  productId: number;
  subTypeName: string;
  lowPrice?: number | null;
  midPrice?: number | null;
  highPrice?: number | null;
  marketPrice?: number | null;
  directLowPrice?: number | null;
}

/**
 * TCGplayer's printing names, in the vocabulary `VARIANT_PREFERENCE` uses.
 * An unlisted sub-type keeps its own name: it still reaches the price policy,
 * just after the printings we know how to rank.
 */
export const SUB_TYPE_TO_VARIANT: Readonly<Record<string, string>> = {
  Normal: 'normal',
  Holofoil: 'holofoil',
  'Reverse Holofoil': 'reverseHolofoil',
  Unlimited: 'unlimited',
  'Unlimited Holofoil': 'unlimitedHolofoil',
  '1st Edition': '1stEdition',
  '1st Edition Normal': '1stEditionNormal',
  '1st Edition Holofoil': '1stEditionHolofoil',
};

/** Both feeds use 0 for "no data", so zero has to be dropped, not stored. */
const positive = (n: number | null | undefined): number | undefined =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;

function variantPrices(row: TcgcsvPrice): TcgPlayerVariantPrices {
  const out: TcgPlayerVariantPrices = {};
  const low = positive(row.lowPrice);
  const mid = positive(row.midPrice);
  const high = positive(row.highPrice);
  const market = positive(row.marketPrice);
  const directLow = positive(row.directLowPrice);
  if (low !== undefined) out.low = low;
  if (mid !== undefined) out.mid = mid;
  if (high !== undefined) out.high = high;
  if (market !== undefined) out.market = market;
  if (directLow !== undefined) out.directLow = directLow;
  return out;
}

/** One product's price rows, in the shape the price policy reads. */
export function toPriceSourceCard(
  rows: readonly TcgcsvPrice[],
  url?: string | null,
): PriceSourceCard {
  const prices: Record<string, TcgPlayerVariantPrices> = {};
  for (const row of rows) {
    prices[SUB_TYPE_TO_VARIANT[row.subTypeName] ?? row.subTypeName] = variantPrices(row);
  }
  return { tcgplayer: { url: url ?? null, prices } };
}

/**
 * The collector number as the catalogue writes it, or null for a sealed
 * product. TCGplayer writes "001/084"; the catalogue writes "1". Lettered
 * gallery numbers ("TG01/TG30") are already in catalogue form.
 */
export function cardNumberOf(product: TcgcsvProduct): string | null {
  const raw = product.extendedData?.find((e) => e.name === 'Number')?.value?.trim();
  if (!raw) return null;
  const head = raw.split('/')[0]?.trim();
  if (!head) return null;
  return /^\d+$/.test(head) ? String(Number(head)) : head.toUpperCase();
}

/**
 * Products that carry the words "booster pack" but are not one. The code card
 * is the digital redemption slip (about $0.20); the art bundle is four sleeved
 * packs sold together; the rest are cases, boxes and blisters.
 */
const NOT_A_PACK =
  /\b(code card|art bundle|set of \d+|sleeved|case|display|blister|bundle|box|deck|tin|collection|checklist|jumbo)\b/i;

const isBoosterPack = (name: string): boolean =>
  /booster pack/i.test(name) && !NOT_A_PACK.test(name);

export interface BoosterPackSelection {
  product: TcgcsvProduct;
  marketPrice: number | null;
}

/**
 * The set's booster pack, preferring one that is actually quoted.
 *
 * Vintage sets list several printings ("[1st Edition]", "[Unlimited
 * Edition]"), often with only one of them currently trading. Among quoted
 * candidates the plainest name wins, which is the ordinary printing.
 */
export function selectBoosterPack(
  products: readonly TcgcsvProduct[],
  pricesByProduct: ReadonlyMap<number, TcgcsvPrice>,
): BoosterPackSelection | null {
  const candidates = products.filter((p) => isBoosterPack(p.name));
  if (candidates.length === 0) return null;

  const byName = (a: TcgcsvProduct, b: TcgcsvProduct) => a.name.length - b.name.length;
  const quoted = candidates
    .filter((p) => positive(pricesByProduct.get(p.productId)?.marketPrice) !== undefined)
    .sort(byName);

  const product = quoted[0] ?? [...candidates].sort(byName)[0]!;
  return {
    product,
    marketPrice: positive(pricesByProduct.get(product.productId)?.marketPrice) ?? null,
  };
}
