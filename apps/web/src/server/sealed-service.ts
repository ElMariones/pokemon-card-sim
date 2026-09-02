import { randomUUID } from 'node:crypto';
import { and, eq, desc, sql, inArray } from 'drizzle-orm';
import { getDb } from '@pcs/db';
import { sets, products, inventoryItems, packTemplates } from '@pcs/db/schema';
import { cents, type Cents } from '@pcs/shared';
import {
  PRODUCT_SHAPES, shapeFor, sealedBaseValue, sealedRetailPrice, sealedBuyOffer,
  driftSealed, yearsSince, mulberry32, applyTransaction, InsufficientFundsError,
  bp, BP_ONE, applyBp, type ProductType,
} from '@pcs/economy-engine';
import { GameError, buyAndOpenPack, type OpenPackResult } from './game';
import { grantXp } from './progression-service';

/**
 * Sealed product (DESIGN.md section 14).
 *
 * Products are derived from a set's simulated pack price rather than
 * configured per set, so every priced set gains a full sealed lineup with no
 * extra data entry. That matters at 174 sets.
 */

export interface SealedOffer {
  productId: string;
  setId: string;
  setName: string;
  logoUrl: string | null;
  type: ProductType;
  label: string;
  packs: number;
  price: Cents;
  currentValue: Cents;
  releaseDate: string;
}

const productId = (setId: string, type: ProductType) => `${setId}-${type}`;

/**
 * Current sealed value, aged from the set's release date.
 *
 * Deterministic per product per day: the seed is derived from the product id
 * and the day, so two requests on the same day agree without storing a row,
 * and the value still moves day to day.
 */
function currentSealedValue(
  base: Cents,
  id: string,
  releaseDate: string,
  now = new Date(),
): Cents {
  const days = Math.floor(now.getTime() / 86_400_000);
  let seed = days;
  for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) >>> 0;

  const rng = mulberry32(seed);
  const years = yearsSince(releaseDate, now);

  // Walk a bounded number of steps rather than one per day since release:
  // 27 years of Base Set would be 10,000 iterations per row.
  let trend = BP_ONE;
  for (let i = 0; i < 60; i++) trend = driftSealed(trend, rng, years);

  return applyBp(base, trend);
}

/**
 * What one pack costs: the sealed market when we have it, the contents-derived
 * figure only where no market covers the set (DESIGN.md section 14).
 */
const EFFECTIVE_PACK_PRICE = sql<number>`coalesce(${packTemplates.marketBasePrice}, ${packTemplates.simulatorPrice})::int`;

/** Sealed products available to buy, for sets we can price. */
export async function listSealedOffers(limit = 60): Promise<SealedOffer[]> {
  const db = await getDb();

  const rows = await db
    .select({
      setId: sets.id,
      setName: sets.name,
      logoUrl: sets.logoUrl,
      releaseDate: sets.releaseDate,
      // A box is priced from what its packs really cost, so it has to read
      // the same effective price the shop and the opening path do.
      packPrice: EFFECTIVE_PACK_PRICE,
    })
    .from(packTemplates)
    .innerJoin(sets, eq(sets.id, packTemplates.setId))
    .where(sql`coalesce(${packTemplates.marketBasePrice}, ${packTemplates.simulatorPrice}) > 0`)
    .orderBy(desc(sets.releaseDate))
    .limit(limit);

  const offers: SealedOffer[] = [];
  for (const r of rows) {
    for (const shape of PRODUCT_SHAPES) {
      const id = productId(r.setId, shape.type);
      const base = sealedBaseValue(cents(r.packPrice), shape);
      offers.push({
        productId: id,
        setId: r.setId,
        setName: r.setName,
        logoUrl: r.logoUrl,
        type: shape.type,
        label: shape.label,
        packs: shape.packs,
        price: sealedRetailPrice(cents(r.packPrice), shape),
        currentValue: currentSealedValue(base, id, r.releaseDate),
        releaseDate: r.releaseDate,
      });
    }
  }
  return offers;
}

/** Ensure the product row exists so inventory can reference it. */
async function ensureProduct(setId: string, type: ProductType, packPrice: Cents) {
  const db = await getDb();
  const shape = shapeFor(type);
  if (!shape) throw new GameError(`Unknown product type: ${type}`, 'bad_product');

  const id = productId(setId, type);
  await db
    .insert(products)
    .values({
      id,
      setId,
      name: shape.label,
      type,
      simulatorPrice: sealedRetailPrice(packPrice, shape),
      sealedBaseValue: sealedBaseValue(packPrice, shape),
      contents: { packs: shape.packs, accessories: shape.accessories },
      source: 'derived',
    })
    .onConflictDoUpdate({
      target: products.id,
      set: {
        simulatorPrice: sealedRetailPrice(packPrice, shape),
        sealedBaseValue: sealedBaseValue(packPrice, shape),
      },
    });
  return { id, shape };
}

async function packPriceFor(setId: string): Promise<Cents> {
  const db = await getDb();
  const [t] = await db
    .select({ price: EFFECTIVE_PACK_PRICE })
    .from(packTemplates)
    .where(eq(packTemplates.id, `${setId}-booster`))
    .limit(1);
  if (!t?.price) throw new GameError('That set has no priced packs yet', 'not_priced');
  return cents(t.price);
}

export async function buySealed(userId: string, setId: string, type: ProductType) {
  const db = await getDb();
  const packPrice = await packPriceFor(setId);
  const { id, shape } = await ensureProduct(setId, type, packPrice);
  const price = sealedRetailPrice(packPrice, shape);

  let balanceAfter: Cents;
  try {
    const res = await applyTransaction(db as never, {
      userId,
      type: 'sealed_purchase',
      amount: cents(-price),
      itemType: 'product',
      itemId: id,
      metadata: { setId, type, packs: shape.packs },
    });
    balanceAfter = res.balanceAfter;
  } catch (err) {
    if (err instanceof InsufficientFundsError) {
      throw new GameError('Not enough cash for that product', 'insufficient_funds');
    }
    throw err;
  }

  const inventoryId = randomUUID();
  await db.insert(inventoryItems).values({
    id: inventoryId,
    userId,
    type: 'product',
    productId: id,
    quantity: 1,
    acquisitionSource: 'market',
    acquisitionPrice: price,
    status: 'owned',
  });

  return { inventoryId, productId: id, label: shape.label, packs: shape.packs, price, balanceAfter: balanceAfter! };
}

export interface SealedHolding {
  inventoryId: string;
  productId: string;
  label: string;
  type: ProductType;
  packs: number;
  setId: string;
  setName: string;
  logoUrl: string | null;
  paid: Cents;
  currentValue: Cents;
  buyOffer: Cents;
  gain: Cents;
  acquiredAt: string;
}

export async function listHoldings(userId: string): Promise<SealedHolding[]> {
  const db = await getDb();
  const rows = await db
    .select({
      inventoryId: inventoryItems.id,
      paid: inventoryItems.acquisitionPrice,
      acquiredAt: inventoryItems.acquiredAt,
      productId: products.id,
      type: products.type,
      name: products.name,
      base: products.sealedBaseValue,
      contents: products.contents,
      setId: sets.id,
      setName: sets.name,
      logoUrl: sets.logoUrl,
      releaseDate: sets.releaseDate,
    })
    .from(inventoryItems)
    .innerJoin(products, eq(products.id, inventoryItems.productId))
    .innerJoin(sets, eq(sets.id, products.setId))
    .where(
      and(
        eq(inventoryItems.userId, userId),
        eq(inventoryItems.type, 'product'),
        eq(inventoryItems.status, 'owned'),
      ),
    )
    .orderBy(desc(inventoryItems.acquiredAt));

  return rows.map((r) => {
    const value = currentSealedValue(cents(r.base), r.productId, r.releaseDate);
    return {
      inventoryId: r.inventoryId,
      productId: r.productId,
      label: r.name,
      type: r.type as ProductType,
      packs: Number((r.contents as { packs?: number })?.packs ?? 0),
      setId: r.setId,
      setName: r.setName,
      logoUrl: r.logoUrl,
      paid: cents(r.paid),
      currentValue: value,
      buyOffer: sealedBuyOffer(value),
      gain: cents(sealedBuyOffer(value) - r.paid),
      acquiredAt: new Date(r.acquiredAt).toISOString(),
    };
  });
}

/** Sell a sealed product to the dealer without opening it. */
export async function sellSealed(userId: string, inventoryId: string) {
  const db = await getDb();
  const holdings = await listHoldings(userId);
  const holding = holdings.find((h) => h.inventoryId === inventoryId);
  if (!holding) throw new GameError('You do not own that product', 'not_owned');

  await db
    .update(inventoryItems)
    .set({ status: 'sold' })
    .where(eq(inventoryItems.id, inventoryId));

  const { balanceAfter } = await applyTransaction(db as never, {
    userId,
    type: 'sealed_sale',
    amount: holding.buyOffer,
    itemType: 'product',
    itemId: holding.productId,
    metadata: { inventoryId, paid: holding.paid, value: holding.currentValue },
  });

  return {
    label: holding.label,
    paid: holding.paid,
    offer: holding.buyOffer,
    gain: cents(holding.buyOffer - holding.paid),
    balanceAfter,
  };
}

export interface OpenSealedResult {
  label: string;
  setName: string;
  packs: OpenPackResult[];
  totalValue: Cents;
  paid: Cents;
  balanceAfter: Cents;
}

/**
 * Open a sealed product: every pack inside is opened.
 *
 * The packs are free at this point — the product was paid for when it was
 * bought, so buyAndOpenPack would charge twice. Opening therefore issues a
 * refund transaction per pack to offset the pack charge, keeping the ledger
 * complete and every movement visible rather than bypassing it.
 */
export async function openSealed(userId: string, inventoryId: string): Promise<OpenSealedResult> {
  const db = await getDb();
  const holdings = await listHoldings(userId);
  const holding = holdings.find((h) => h.inventoryId === inventoryId);
  if (!holding) throw new GameError('You do not own that product', 'not_owned');

  await db
    .update(inventoryItems)
    .set({ status: 'sold' })
    .where(eq(inventoryItems.id, inventoryId));

  const packs: OpenPackResult[] = [];
  let totalValue = 0;
  let balanceAfter = cents(0);

  for (let i = 0; i < holding.packs; i++) {
    const result = await buyAndOpenPack(userId, holding.setId);
    // Refund the pack charge: the player already paid for the sealed product.
    const refund = await applyTransaction(db as never, {
      userId,
      type: 'sealed_purchase',
      amount: result.cost,
      itemType: 'product',
      itemId: holding.productId,
      metadata: { reason: 'pack included in sealed product', inventoryId },
    });
    balanceAfter = refund.balanceAfter;
    totalValue += result.totalValue;
    packs.push(result);
  }

  await grantXp(userId, 'pack_opened', Math.max(0, holding.packs - 1));

  return {
    label: holding.label,
    setName: holding.setName,
    packs,
    totalValue: cents(totalValue),
    paid: holding.paid,
    balanceAfter,
  };
}
