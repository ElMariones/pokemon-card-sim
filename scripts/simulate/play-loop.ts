/**
 * End-to-end smoke test of the core gameplay loop against the real database.
 *
 *   create player -> buy pack -> open it -> sell a card -> verify the ledger
 *
 * Verifies the accounting invariant that matters most: the stored balance
 * always equals the sum of the ledger.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '../../packages/db/src/index.js';
import { users } from '../../packages/db/src/schema.js';
import { formatCents, cents } from '../../packages/shared/src/index.js';
import { applyTransaction, auditBalance } from '../../packages/economy-engine/src/ledger.js';
import { buyAndOpenPack, sellCard, getPackPrice } from '../../apps/web/src/server/game.js';
import { parseArgs, runScript } from '../import/http.js';

async function main() {
  const args = parseArgs();
  const setId = typeof args.set === 'string' ? args.set : 'base1';
  const db = await getDb();

  const userId = randomUUID();
  await db.insert(users).values({ id: userId, cash: 0, sessionToken: `test-${userId}` });
  await applyTransaction(db as never, {
    userId, type: 'starting_balance', amount: cents(50_000),
  });
  console.log(`Player created with ${formatCents(cents(50_000))}\n`);

  const price = await getPackPrice(setId);
  console.log(`Pack price for ${setId}: ${formatCents(price)}\n`);

  const result = await buyAndOpenPack(userId, setId);

  console.log(`Opened "${result.setName}"  (${result.cards.length} cards)`);
  console.log(`  pull-rate confidence: ${result.confidence}`);
  console.log(`  seed hash: ${result.seedHash.slice(0, 16)}...`);
  console.log(`  cost ${formatCents(result.cost)}   contents ${formatCents(result.totalValue)}`);
  console.log(`  balance now ${formatCents(result.balanceAfter)}\n`);

  for (const c of result.cards) {
    const tag = c.isHit ? ' ** HIT **' : c.isReverse ? ' (reverse)' : '';
    console.log(
      `    ${c.slotName.padEnd(13)} ${c.number.padStart(4)}  ${c.name.padEnd(24).slice(0, 24)} ` +
      `${c.rarityTier.padEnd(12)} ${formatCents(c.value).padStart(10)}${tag}`,
    );
  }

  const best = [...result.cards].sort((a, b) => b.value - a.value)[0]!;
  console.log(`\nSelling the most valuable card: ${best.name}`);
  const sale = await sellCard(userId, best.inventoryId);
  console.log(`  market ${formatCents(sale.marketValue)} -> dealer paid ${formatCents(sale.offer)}`);
  console.log(`  spread kept by the dealer: ${formatCents(cents(sale.marketValue - sale.offer))}`);
  console.log(`  balance now ${formatCents(sale.balanceAfter)}\n`);

  const audit = await auditBalance(db as never, userId);
  console.log('Ledger audit');
  console.log(`  stored balance   ${formatCents(audit.stored)}`);
  console.log(`  sum of ledger    ${formatCents(audit.computed)}`);
  console.log(`  consistent       ${audit.consistent ? 'YES' : 'NO — LEDGER DRIFT'}`);

  // Overdraft must be refused.
  await db.update(users).set({ cash: 10 }).where(eq(users.id, userId));
  let refused = false;
  try {
    await buyAndOpenPack(userId, setId);
  } catch (err) {
    refused = (err as Error).message.includes('Not enough cash');
  }
  console.log(`  overdraft refused ${refused ? 'YES' : 'NO — PLAYER CAN GO NEGATIVE'}`);

  if (!audit.consistent || !refused) {
    throw new Error('Accounting invariant violated');
  }
  console.log('\nCore loop OK.');
}

runScript(main);
