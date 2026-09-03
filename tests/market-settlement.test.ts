import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getMemoryDb, type Database } from '@pcs/db';
import { cards, inventoryItems, listings, sets, transactions, users } from '@pcs/db/schema';
import { cents } from '@pcs/shared';
import {
  CLIENT_INTERVAL_SECONDS, netProceeds, resolveVisits,
} from '@pcs/economy-engine';
import { settleMarket } from '../apps/web/src/server/market-service';

const USER = 'player';

async function freshDb(): Promise<Database> {
  const db = await getMemoryDb();
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await migrate(db as any, { migrationsFolder: './packages/db/migrations' });
  return db;
}

describe('market settlement', () => {
  let db: Database;

  beforeEach(async () => {
    db = await freshDb();
    await db.insert(users).values({ id: USER, cash: 50_000 });
    await db.insert(sets).values({
      id: 'test-set', name: 'Test Set', series: 'Test', era: 'sv',
      releaseDate: '2026-01-01', printedTotal: 1, total: 1, source: 'test',
    });
    await db.insert(cards).values({
      id: 'card-a', setId: 'test-set', name: 'Test Card', number: '1',
      rarityTier: 'secret_rare', marketBasePrice: 1_000, source: 'test',
    });
    await db.insert(inventoryItems).values({
      id: 'inventory-a', userId: USER, type: 'card', cardId: 'card-a', quantity: 1,
      condition: 'near_mint', acquisitionSource: 'pack', acquisitionPrice: 0, status: 'listed',
    });
  });

  it('pays, records, and removes a sold card exactly once across overlapping checks', async () => {
    const askPrice = cents(1_000);
    const marketValue = cents(1_000);
    const elapsedSeconds = CLIENT_INTERVAL_SECONDS * 10;
    let listingId = '';
    for (let index = 0; index < 1_000; index++) {
      const candidate = `listing-${index}`;
      if (resolveVisits({
        listingId: candidate,
        visitsSoFar: 0,
        elapsedSeconds,
        askPrice,
        marketValue,
        rarityTier: 'secret_rare',
      }).sold) {
        listingId = candidate;
        break;
      }
    }
    expect(listingId).not.toBe('');

    await db.insert(listings).values({
      id: listingId,
      userId: USER,
      inventoryItemId: 'inventory-a',
      cardId: 'card-a',
      askPrice,
      marketValueAtListing: marketValue,
      status: 'active',
      listedAt: new Date(Date.now() - elapsedSeconds * 1_000),
      lastCheckedAt: new Date(Date.now() - elapsedSeconds * 1_000),
    });

    const [first, second] = await Promise.all([
      settleMarket(USER, db),
      settleMarket(USER, db),
    ]);
    const sales = [...first.justSold, ...second.justSold];
    expect(sales).toHaveLength(1);

    const expectedBalance = 50_000 + netProceeds(askPrice).net;
    expect(first.balanceAfter ?? second.balanceAfter).toBe(expectedBalance);

    const [user] = await db.select({ cash: users.cash }).from(users).where(eq(users.id, USER));
    expect(user?.cash).toBe(expectedBalance);
    const ledger = await db.select().from(transactions).where(eq(transactions.itemId, listingId));
    expect(ledger).toHaveLength(1);
    const [item] = await db.select({ status: inventoryItems.status })
      .from(inventoryItems).where(eq(inventoryItems.id, 'inventory-a'));
    expect(item?.status).toBe('sold');
  });
});
