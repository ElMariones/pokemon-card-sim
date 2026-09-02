/** Database-backed acceptance smoke test for the NPC dealer circuit. */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { assertNotLocked, getDb } from '../../packages/db/src/index';
import {
  cards,
  grades,
  inventoryItems,
  npcShopStock,
  transactions,
  users,
} from '../../packages/db/src/schema';
import { auditBalance } from '../../packages/economy-engine/src/ledger';
import { cents } from '../../packages/shared/src/index';
import {
  getNpcMarket,
  makeOffer,
  openNegotiation,
} from '../../apps/web/src/server/npc-market-service';

assertNotLocked();
const db = await getDb();
const userId = `npc-market-smoke-${randomUUID()}`;
const startingCash = cents(1_000_000);

try {
  await db.insert(users).values({ id: userId, cash: startingCash, albumCapacity: 100 });
  await db.insert(transactions).values({
    id: randomUUID(), userId, type: 'starting_balance', amount: startingCash,
    balanceAfter: startingCash, itemType: 'account', itemId: userId,
  });

  const tradeCards = await db.select({ id: cards.id })
    .from(cards)
    .where(and(
      inArray(cards.rarityTier, ['rare', 'holo_rare', 'promo']),
      gte(cards.marketBasePrice, 200),
      lte(cards.marketBasePrice, 450),
    )).orderBy(asc(cards.marketBasePrice)).limit(2);
  if (tradeCards.length !== 2) throw new Error('Smoke test needs two low-value trade cards');

  const tradeInventoryIds: string[] = tradeCards.map(() => randomUUID());
  await db.insert(inventoryItems).values(tradeCards.map((card, index) => ({
    id: tradeInventoryIds[index]!, userId, type: 'card', cardId: card.id, quantity: 1,
    condition: 'near_mint', acquisitionSource: 'starter', acquisitionPrice: 0, status: 'owned',
  })));

  const market = await getNpcMarket(userId, db);
  const stock = market.dealers.flatMap((dealer) => dealer.stock)
    .sort((a, b) => b.askPrice - a.askPrice)[0];
  if (!stock) throw new Error('NPC market generated no stock');

  const opened = await openNegotiation(userId, stock.id, db);
  const selected = opened.trades.filter((card) => tradeInventoryIds.includes(card.inventoryId));
  if (selected.length !== 2) {
    throw new Error(
      `Both smoke-test cards should match dealer interests (${opened.trades.length} eligible; `
      + `${selected.length} fixture matches)`,
    );
  }
  const tradeTotal = selected.reduce((sum, card) => sum + card.credit, 0);

  const [privateStock] = await db.select({ floor: npcShopStock.sellerFloor })
    .from(npcShopStock).where(eq(npcShopStock.id, stock.id)).limit(1);
  if (!privateStock || tradeTotal >= privateStock.floor) {
    throw new Error('Generated stock is not valuable enough for the two-card trade smoke test');
  }

  const result = await makeOffer(userId, {
    stockId: stock.id,
    negotiationId: opened.negotiation.id,
    totalOffer: cents(privateStock.floor),
    tradeInventoryIds,
  }, db);
  if (!result.purchased) throw new Error('Seller should accept an offer at their fixed floor');

  const [purchased] = await db.select({ id: inventoryItems.id, status: inventoryItems.status })
    .from(inventoryItems).where(eq(inventoryItems.id, result.inventoryId)).limit(1);
  const traded = await db.select({ id: inventoryItems.id, status: inventoryItems.status })
    .from(inventoryItems).where(inArray(inventoryItems.id, tradeInventoryIds));
  const purchaseLedger = await db.select().from(transactions).where(and(
    eq(transactions.userId, userId), eq(transactions.itemId, stock.id),
  ));
  const purchasedGrade = await db.select().from(grades)
    .where(eq(grades.inventoryItemId, result.inventoryId));
  const audit = await auditBalance(db as never, userId);

  if (purchased?.status !== 'owned') throw new Error('Purchased card was not added to inventory');
  if (traded.some((item) => item.status !== 'traded')) throw new Error('Trade cards did not leave inventory');
  if (purchaseLedger.length !== 1) throw new Error('Purchase should produce exactly one ledger row');
  if (!audit.consistent) throw new Error('Cash and ledger diverged after the mixed trade');
  if (stock.grade && purchasedGrade.length !== 1) throw new Error('Graded stock lost its slab record');

  console.log(
    `NPC market smoke passed: ${stock.name}, ${selected.length} trades + $${(result.cashPaid / 100).toFixed(2)}, balance consistent.`,
  );
} finally {
  await db.delete(users).where(eq(users.id, userId));
}

process.exit(0);
