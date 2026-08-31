import { randomUUID } from 'node:crypto';
import { and, eq, desc, sql, inArray } from 'drizzle-orm';
import { getDb } from '@pcs/db';
import { listings, inventoryItems, cards, sets, grades, users } from '@pcs/db/schema';
import { cents, type Cents, type RarityTier } from '@pcs/shared';
import {
  computePrice, gradedValue, dealerBuyOffer, applyTransaction,
  resolveVisits, visitChance, expectedSecondsToSell, outlookFor, netProceeds,
  CLIENT_INTERVAL_SECONDS, OUTLOOK_LABEL,
} from '@pcs/economy-engine';
import { GameError } from './game';
import { grantXp } from './progression-service';

/**
 * The player marketplace.
 *
 * Buyers are resolved lazily: rather than running a background worker, every
 * read of the market first settles the visitors that arrived since the last
 * look. The consumed visit count is persisted, so the outcome of a visit is
 * fixed once and a refresh cannot re-roll it.
 */

export interface ListingView {
  id: string;
  inventoryItemId: string;
  cardId: string;
  name: string;
  number: string;
  rarityTier: RarityTier;
  imageSmall: string | null;
  setName: string;
  askPrice: Cents;
  marketValue: Cents;
  ratioBp: number;
  outlook: string;
  outlookLabel: string;
  /** Expected wait in seconds. An estimate, and labelled as one in the UI. */
  expectedSeconds: number;
  visits: number;
  listedAt: string;
  dealerAlternative: Cents;
  netIfSold: Cents;
}

export interface SoldView {
  id: string;
  name: string;
  imageSmall: string | null;
  soldPrice: Cents;
  feePaid: Cents;
  netProceeds: Cents;
  marketValue: Cents;
  buyerName: string | null;
  buyerNote: string | null;
  soldAt: string;
  visits: number;
}

/** Current market value of one inventory item, grade included. */
async function valueOf(inventoryItemId: string): Promise<{
  value: Cents;
  cardId: string;
  rarityTier: RarityTier;
} | null> {
  const db = await getDb();
  const [row] = await db
    .select({
      cardId: cards.id,
      rarityTier: cards.rarityTier,
      basePrice: cards.marketBasePrice,
      condition: inventoryItems.condition,
      status: inventoryItems.status,
      gradeCompany: grades.gradeCompany,
      numericGrade: grades.numericGrade,
      gradeLabel: grades.label,
    })
    .from(inventoryItems)
    .innerJoin(cards, eq(cards.id, inventoryItems.cardId))
    .leftJoin(
      grades,
      and(eq(grades.inventoryItemId, inventoryItems.id), eq(grades.status, 'completed')),
    )
    .where(eq(inventoryItems.id, inventoryItemId))
    .limit(1);

  if (!row) return null;

  const raw = computePrice(cents(row.basePrice ?? 0), {
    condition: (row.condition ?? 'near_mint') as never,
  });
  const value = row.numericGrade != null
    ? gradedValue(raw, {
        company: row.gradeCompany as never,
        numericGrade: row.numericGrade,
        label: row.gradeLabel ?? '',
        isBlackLabel: (row.gradeLabel ?? '').includes('Black Label'),
      })
    : raw;

  return { value, cardId: row.cardId, rarityTier: row.rarityTier as RarityTier };
}

/**
 * Settle every active listing for a player against the time that has passed.
 *
 * Runs before any market read. Each sale pays out through the ledger like any
 * other money movement.
 */
export async function settleMarket(userId: string): Promise<SoldView[]> {
  const db = await getDb();
  const now = new Date();

  const active = await db
    .select({
      id: listings.id,
      inventoryItemId: listings.inventoryItemId,
      cardId: listings.cardId,
      askPrice: listings.askPrice,
      marketValueAtListing: listings.marketValueAtListing,
      visits: listings.visits,
      lastCheckedAt: listings.lastCheckedAt,
      rarityTier: cards.rarityTier,
      name: cards.name,
      imageSmall: cards.imageSmall,
    })
    .from(listings)
    .innerJoin(cards, eq(cards.id, listings.cardId))
    .where(and(eq(listings.userId, userId), eq(listings.status, 'active')));

  const justSold: SoldView[] = [];

  for (const l of active) {
    const elapsed = (now.getTime() - new Date(l.lastCheckedAt).getTime()) / 1000;
    if (elapsed < CLIENT_INTERVAL_SECONDS) continue;

    // Value is re-read rather than trusted from listing time: the market moves,
    // and a card that has appreciated should become easier to sell, not stay
    // pinned to the ratio it had when it was listed.
    const current = await valueOf(l.inventoryItemId);
    const marketValue = current?.value ?? cents(l.marketValueAtListing);

    const result = resolveVisits({
      listingId: l.id,
      visitsSoFar: l.visits,
      elapsedSeconds: elapsed,
      askPrice: cents(l.askPrice),
      marketValue,
      rarityTier: l.rarityTier as RarityTier,
    });

    if (result.visits === 0) continue;

    if (!result.sold) {
      await db
        .update(listings)
        .set({ visits: l.visits + result.visits, lastCheckedAt: now })
        .where(eq(listings.id, l.id));
      continue;
    }

    const price = cents(l.askPrice);
    const { fee, net } = netProceeds(price);

    await db.transaction(async (tx: any) => {
      await tx
        .update(listings)
        .set({
          status: 'sold',
          visits: l.visits + result.visits,
          lastCheckedAt: now,
          soldAt: now,
          soldPrice: price,
          feePaid: fee,
          buyerName: result.sold!.buyer.name,
          buyerNote: result.sold!.buyer.note,
        })
        .where(eq(listings.id, l.id));

      await tx
        .update(inventoryItems)
        .set({ status: 'sold' })
        .where(eq(inventoryItems.id, l.inventoryItemId));
    });

    await applyTransaction(db as never, {
      userId,
      type: 'card_sale',
      amount: net,
      itemType: 'listing',
      itemId: l.id,
      metadata: {
        via: 'marketplace',
        askPrice: price,
        fee,
        buyer: result.sold.buyer.name,
        marketValue,
      },
    });
    await grantXp(userId, 'card_sold');

    justSold.push({
      id: l.id,
      name: l.name,
      imageSmall: l.imageSmall,
      soldPrice: price,
      feePaid: fee,
      netProceeds: net,
      marketValue,
      buyerName: result.sold.buyer.name,
      buyerNote: result.sold.buyer.note,
      soldAt: now.toISOString(),
      visits: l.visits + result.visits,
    });
  }

  return justSold;
}

export async function listActive(userId: string): Promise<ListingView[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: listings.id,
      inventoryItemId: listings.inventoryItemId,
      cardId: listings.cardId,
      askPrice: listings.askPrice,
      marketValueAtListing: listings.marketValueAtListing,
      visits: listings.visits,
      listedAt: listings.listedAt,
      name: cards.name,
      number: cards.number,
      rarityTier: cards.rarityTier,
      imageSmall: cards.imageSmall,
      setName: sets.name,
    })
    .from(listings)
    .innerJoin(cards, eq(cards.id, listings.cardId))
    .innerJoin(sets, eq(sets.id, cards.setId))
    .where(and(eq(listings.userId, userId), eq(listings.status, 'active')))
    .orderBy(desc(listings.listedAt));

  const out: ListingView[] = [];
  for (const r of rows) {
    const current = await valueOf(r.inventoryItemId);
    const marketValue = current?.value ?? cents(r.marketValueAtListing);
    const tier = r.rarityTier as RarityTier;
    const askPrice = cents(r.askPrice);
    const outlook = outlookFor(askPrice, marketValue);

    out.push({
      id: r.id,
      inventoryItemId: r.inventoryItemId,
      cardId: r.cardId,
      name: r.name,
      number: r.number,
      rarityTier: tier,
      imageSmall: r.imageSmall,
      setName: r.setName,
      askPrice,
      marketValue,
      ratioBp: marketValue > 0 ? Math.round((askPrice / marketValue) * 10_000) : 0,
      outlook,
      outlookLabel: OUTLOOK_LABEL[outlook],
      expectedSeconds: Math.round(
        expectedSecondsToSell({ askPrice, marketValue, rarityTier: tier }),
      ),
      visits: r.visits,
      listedAt: new Date(r.listedAt).toISOString(),
      dealerAlternative: dealerBuyOffer(marketValue),
      netIfSold: netProceeds(askPrice).net,
    });
  }
  return out;
}

export async function listSold(userId: string, limit = 20): Promise<SoldView[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: listings.id,
      name: cards.name,
      imageSmall: cards.imageSmall,
      soldPrice: listings.soldPrice,
      feePaid: listings.feePaid,
      marketValueAtListing: listings.marketValueAtListing,
      buyerName: listings.buyerName,
      buyerNote: listings.buyerNote,
      soldAt: listings.soldAt,
      visits: listings.visits,
    })
    .from(listings)
    .innerJoin(cards, eq(cards.id, listings.cardId))
    .where(and(eq(listings.userId, userId), eq(listings.status, 'sold')))
    .orderBy(desc(listings.soldAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    imageSmall: r.imageSmall,
    soldPrice: cents(r.soldPrice ?? 0),
    feePaid: cents(r.feePaid ?? 0),
    netProceeds: cents((r.soldPrice ?? 0) - (r.feePaid ?? 0)),
    marketValue: cents(r.marketValueAtListing),
    buyerName: r.buyerName,
    buyerNote: r.buyerNote,
    soldAt: r.soldAt ? new Date(r.soldAt).toISOString() : '',
    visits: r.visits,
  }));
}

export async function createListing(userId: string, inventoryItemId: string, askPrice: Cents) {
  const db = await getDb();

  const [item] = await db
    .select({ id: inventoryItems.id, status: inventoryItems.status, cardId: inventoryItems.cardId })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, inventoryItemId), eq(inventoryItems.userId, userId)))
    .limit(1);

  if (!item) throw new GameError('You do not own that card', 'not_owned');
  if (item.status !== 'owned') throw new GameError('That card is not available', 'not_available');
  if (!item.cardId) throw new GameError('That item is not a card', 'not_a_card');

  const current = await valueOf(inventoryItemId);
  if (!current || current.value <= 0) {
    throw new GameError('That card has no market value to price against', 'no_market_value');
  }
  if (askPrice < 1) throw new GameError('Ask at least one cent', 'bad_price');
  // A ceiling keeps the listings table meaningful; anything past this is noise.
  if (askPrice > current.value * 50) {
    throw new GameError('That is more than 50x market value', 'price_too_high');
  }

  const id = randomUUID();
  const now = new Date();

  await db.transaction(async (tx: any) => {
    await tx.insert(listings).values({
      id,
      userId,
      inventoryItemId,
      cardId: item.cardId!,
      askPrice,
      marketValueAtListing: current.value,
      status: 'active',
      listedAt: now,
      lastCheckedAt: now,
    });
    // The card leaves the collection while it is on the table, so it cannot be
    // sold to the dealer and to a buyer at the same time.
    await tx
      .update(inventoryItems)
      .set({ status: 'listed' })
      .where(eq(inventoryItems.id, inventoryItemId));
  });

  return { listingId: id, askPrice, marketValue: current.value };
}

export async function cancelListing(userId: string, listingId: string) {
  const db = await getDb();
  const [l] = await db
    .select({ id: listings.id, status: listings.status, inventoryItemId: listings.inventoryItemId })
    .from(listings)
    .where(and(eq(listings.id, listingId), eq(listings.userId, userId)))
    .limit(1);

  if (!l) throw new GameError('No such listing', 'not_found');
  if (l.status !== 'active') throw new GameError('That listing is no longer active', 'not_active');

  await db.transaction(async (tx: any) => {
    await tx.update(listings).set({ status: 'cancelled' }).where(eq(listings.id, listingId));
    await tx
      .update(inventoryItems)
      .set({ status: 'owned' })
      .where(eq(inventoryItems.id, l.inventoryItemId));
  });

  return { cancelled: listingId };
}

/** Suggested prices, so the player has something to price against. */
export async function priceGuide(userId: string, inventoryItemId: string) {
  const current = await valueOf(inventoryItemId);
  if (!current) throw new GameError('You do not own that card', 'not_owned');

  const market = current.value;
  const points = [0.9, 1.0, 1.1, 1.2, 1.5].map((ratio) => {
    const askPrice = cents(Math.round(market * ratio));
    return {
      ratio,
      askPrice,
      net: netProceeds(askPrice).net,
      outlook: outlookFor(askPrice, market),
      expectedSeconds: Math.round(
        expectedSecondsToSell({ askPrice, marketValue: market, rarityTier: current.rarityTier }),
      ),
    };
  });

  return { marketValue: market, dealerOffer: dealerBuyOffer(market), points };
}
