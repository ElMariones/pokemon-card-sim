/**
 * End-to-end check of the marketplace and bulk duplicate sale.
 *
 * The properties that matter:
 *   - a listed card leaves the collection, so it cannot be sold twice
 *   - an over-priced card still sells, just after more visitors
 *   - the seller nets more than the dealer would have paid
 *   - favourited and graded copies are never swept up as duplicates
 *   - the ledger still reconciles after all of it
 */
import { randomUUID } from 'node:crypto';
import { eq, and, sql } from 'drizzle-orm';
import { getDb, assertNotLocked } from '../../packages/db/src/index';
import { users, inventoryItems, listings, cards } from '../../packages/db/src/schema';
import { cents, formatCents } from '../../packages/shared/src/index';
import { applyTransaction, auditBalance } from '../../packages/economy-engine/src/ledger';
import { dealerBuyOffer } from '../../packages/economy-engine/src/pricing';
import { CLIENT_INTERVAL_SECONDS } from '../../packages/economy-engine/src/marketplace';
import { buyAndOpenPack } from '../../apps/web/src/server/game';
import { createListing, settleMarket, listActive, listSold } from '../../apps/web/src/server/market-service';
import { getDuplicates, sellDuplicates } from '../../apps/web/src/server/collection';
import { runScript } from '../import/http';

async function main() {
  assertNotLocked();
  const db = await getDb();
  const userId = randomUUID();

  await db.insert(users).values({ id: userId, cash: 0, sessionToken: `mkt-${userId}` });
  await applyTransaction(db as never, {
    userId, type: 'starting_balance', amount: cents(500_00),
  });
  console.log('Player created with $500.00\n');

  // Open packs so there is stock, and duplicates.
  for (let i = 0; i < 6; i++) await buyAndOpenPack(userId, 'sv3pt5');

  const owned = await db
    .select({ id: inventoryItems.id, name: cards.name, price: cards.marketBasePrice })
    .from(inventoryItems)
    .innerJoin(cards, eq(cards.id, inventoryItems.cardId))
    .where(and(eq(inventoryItems.userId, userId), eq(inventoryItems.status, 'owned')))
    .orderBy(sql`${cards.marketBasePrice} desc nulls last`)
    .limit(1);

  const best = owned[0]!;
  console.log(`Best card: ${best.name} at ${formatCents(cents(best.price ?? 0))}`);

  // ── List it 20% over market ─────────────────────────────────────────────
  const marketValue = cents(best.price ?? 0);
  const ask = cents(Math.round(marketValue * 1.2));
  const { listingId } = await createListing(userId, best.id, ask);
  console.log(`Listed at ${formatCents(ask)} (120% of market)\n`);

  const [after] = await db
    .select({ status: inventoryItems.status })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, best.id));
  const leftCollection = after?.status === 'listed';
  console.log(`Card left the collection while listed: ${leftCollection ? 'YES' : 'NO — CAN BE DOUBLE SOLD'}`);

  // ── Wind the clock back so buyers are due ───────────────────────────────
  const windBack = (seconds: number) =>
    db.update(listings)
      .set({ lastCheckedAt: new Date(Date.now() - seconds * 1000) })
      .where(eq(listings.id, listingId));

  let sold = null;
  let rounds = 0;
  for (; rounds < 40 && !sold; rounds++) {
    await windBack(CLIENT_INTERVAL_SECONDS * 20); // 20 visitors per round
    const results = await settleMarket(userId);
    sold = results[0] ?? null;
  }

  if (!sold) throw new Error('A 120% listing never sold — "eventually" is broken');

  const dealerWouldPay = dealerBuyOffer(marketValue);
  console.log(`\nSold after ${sold.visits} visitors, over ${rounds} rounds`);
  console.log(`  buyer        ${sold.buyerName} — ${sold.buyerNote}`);
  console.log(`  asked        ${formatCents(sold.soldPrice)}`);
  console.log(`  fee          ${formatCents(sold.feePaid)}`);
  console.log(`  you got      ${formatCents(sold.netProceeds)}`);
  console.log(`  dealer would ${formatCents(dealerWouldPay)}`);
  const beatDealer = sold.netProceeds > dealerWouldPay;
  console.log(`  beat the dealer: ${beatDealer ? 'YES' : 'NO — MARKET IS POINTLESS'}`);

  // ── Duplicates ──────────────────────────────────────────────────────────
  const groups = await getDuplicates(userId, 1);
  const surplus = groups.reduce((a, g) => a + g.surplus, 0);
  console.log(`\nDuplicate groups: ${groups.length}, spare copies: ${surplus}`);

  // Favourite one spare copy and confirm it survives the sweep.
  let protectedId: string | null = null;
  if (groups.length > 0) {
    const [copy] = await db
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.userId, userId),
          eq(inventoryItems.cardId, groups[0]!.cardId),
          eq(inventoryItems.status, 'owned'),
        ),
      )
      .limit(1);
    if (copy) {
      protectedId = copy.id;
      await db.update(inventoryItems).set({ favorite: true }).where(eq(inventoryItems.id, copy.id));
    }
  }

  const batch = await sellDuplicates(userId, 1);
  console.log(`Bulk sold ${batch.soldCount} duplicates for ${formatCents(batch.proceeds)}`);

  let favouriteSurvived = true;
  if (protectedId) {
    const [row] = await db
      .select({ status: inventoryItems.status, favorite: inventoryItems.favorite })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, protectedId));
    favouriteSurvived = row?.status === 'owned';
    console.log(`Favourited copy survived the sweep: ${favouriteSurvived ? 'YES' : 'NO — DESTROYED A KEPT CARD'}`);
  }

  // Every card should still have at least one copy left.
  const remaining = await getDuplicates(userId, 1);
  const leftover = remaining.reduce((a, g) => a + g.surplus, 0);
  console.log(`Spare copies remaining after the sweep: ${leftover} (favourites aside)`);

  const audit = await auditBalance(db as never, userId);
  console.log(`\nLedger consistent: ${audit.consistent ? 'YES' : 'NO — DRIFT'}`);
  console.log(`  stored ${formatCents(audit.stored)}  ledger ${formatCents(audit.computed)}`);

  if (!leftCollection || !beatDealer || !favouriteSurvived || !audit.consistent) {
    throw new Error('Marketplace invariant violated');
  }
  console.log('\nMarketplace OK.');
}

runScript(main);
