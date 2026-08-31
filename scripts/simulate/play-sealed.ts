/**
 * End-to-end check of the sealed product loop.
 *
 * The invariant that matters: opening a sealed product must not charge the
 * player twice. The packs inside were paid for when the product was bought,
 * and buyAndOpenPack charges per pack, so openSealed refunds each charge. If
 * that offset is wrong the player is silently billed twice and the ledger will
 * show it.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb, assertNotLocked } from '../../packages/db/src/index';
import { users } from '../../packages/db/src/schema';
import { cents, formatCents } from '../../packages/shared/src/index';
import { applyTransaction, auditBalance } from '../../packages/economy-engine/src/ledger';
import { listSealedOffers, buySealed, listHoldings, openSealed, sellSealed } from '../../apps/web/src/server/sealed-service';
import { runScript } from '../import/http';

async function main() {
  assertNotLocked();
  const db = await getDb();
  const userId = randomUUID();

  const START = cents(2_000_00);
  await db.insert(users).values({ id: userId, cash: 0, sessionToken: `sealed-${userId}` });
  await applyTransaction(db as never, { userId, type: 'starting_balance', amount: START });
  console.log(`Player created with ${formatCents(START)}\n`);

  const offers = await listSealedOffers(20);
  const etb = offers.find((o) => o.type === 'elite_trainer_box' && o.price < 100_000);
  const tin = offers.find((o) => o.type === 'tin' && o.price < 50_000);
  if (!etb || !tin) throw new Error('No affordable sealed products found');

  console.log(`Shelf: ${etb.setName} ${etb.label} at ${formatCents(etb.price)} (${etb.packs} packs)`);
  console.log(`       ${tin.setName} ${tin.label} at ${formatCents(tin.price)} (${tin.packs} packs)\n`);

  const boughtEtb = await buySealed(userId, etb.setId, etb.type as never);
  const boughtTin = await buySealed(userId, tin.setId, tin.type as never);
  console.log(`Bought both for ${formatCents(cents(boughtEtb.price + boughtTin.price))}`);

  const holdings = await listHoldings(userId);
  console.log(`Holdings: ${holdings.length}`);
  for (const h of holdings) {
    console.log(
      `  ${h.label.padEnd(20)} paid ${formatCents(h.paid).padStart(10)}` +
        `  offer ${formatCents(h.buyOffer).padStart(10)}  ${h.gain >= 0 ? '+' : '-'}${formatCents(cents(Math.abs(h.gain)))}`,
    );
  }

  // Sell one sealed, open the other.
  const sold = await sellSealed(userId, boughtTin.inventoryId);
  console.log(`\nSold the tin sealed: paid ${formatCents(sold.paid)}, got ${formatCents(sold.offer)}`);

  const balanceBeforeOpen = (
    await db.select({ cash: users.cash }).from(users).where(eq(users.id, userId)).limit(1)
  )[0]!.cash;

  const opened = await openSealed(userId, boughtEtb.inventoryId);
  const cardCount = opened.packs.reduce((a, p) => a + p.cards.length, 0);
  console.log(
    `\nOpened the ETB: ${opened.packs.length} packs, ${cardCount} cards, ` +
      `contents ${formatCents(opened.totalValue)}`,
  );

  const balanceAfterOpen = (
    await db.select({ cash: users.cash }).from(users).where(eq(users.id, userId)).limit(1)
  )[0]!.cash;

  console.log(`  balance before ${formatCents(cents(balanceBeforeOpen))}`);
  console.log(`  balance after  ${formatCents(cents(balanceAfterOpen))}`);
  const chargedTwice = balanceAfterOpen < balanceBeforeOpen;
  console.log(`  charged again for the packs: ${chargedTwice ? 'YES — DOUBLE BILLED' : 'no'}`);

  const audit = await auditBalance(db as never, userId);
  console.log(`\nLedger consistent: ${audit.consistent ? 'YES' : 'NO — DRIFT'}`);
  console.log(`  stored ${formatCents(audit.stored)}  ledger ${formatCents(audit.computed)}`);

  if (chargedTwice || !audit.consistent) throw new Error('Sealed invariant violated');
  console.log('\nSealed loop OK.');
}

runScript(main);
