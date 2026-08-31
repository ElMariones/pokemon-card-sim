/**
 * End-to-end check that grading is economically coherent.
 *
 * The bug this exists to catch: a graded card that still sells at its raw
 * price. The fee is spent, the card is gone for the turnaround, and the player
 * gets nothing back — grading becomes a pure money sink with no upside, which
 * is not a decision, just a trap.
 */
import { randomUUID } from 'node:crypto';
import { eq, and, desc } from 'drizzle-orm';
import { getDb, assertNotLocked } from '../../packages/db/src/index';
import { users, inventoryItems, cards, grades } from '../../packages/db/src/schema';
import { cents, formatCents } from '../../packages/shared/src/index';
import { applyTransaction, auditBalance } from '../../packages/economy-engine/src/ledger';
import { buyAndOpenPack, sellCard } from '../../apps/web/src/server/game';
import { submitForGrading, collectGrade, listSubmissions } from '../../apps/web/src/server/grading-service';
import { runScript, sleep } from '../import/http';

async function main() {
  assertNotLocked();
  process.env.GRADING_SECONDS_PER_HOUR = '0';   // no waiting in the harness
  const db = await getDb();
  const userId = randomUUID();

  await db.insert(users).values({ id: userId, cash: 0, sessionToken: `grade-${userId}` });
  await applyTransaction(db as never, { userId, type: 'starting_balance', amount: cents(500_00) });

  // Open packs until we hold something worth grading.
  let best: { inventoryId: string; name: string; value: number } | null = null;
  for (let i = 0; i < 12 && (!best || best.value < 200); i++) {
    const r = await buyAndOpenPack(userId, 'sv3pt5');
    for (const c of r.cards) {
      if (!best || c.value > best.value) {
        best = { inventoryId: c.inventoryId, name: c.name, value: c.value };
      }
    }
  }
  if (!best) throw new Error('No cards pulled');
  console.log(`Best card pulled: ${best.name} at ${formatCents(cents(best.value))}\n`);

  const submission = await submitForGrading(userId, best.inventoryId, 'cgc-standard');
  console.log(`Submitted to ${submission.company} ${submission.tierName}, fee ${formatCents(submission.fee)}`);

  await sleep(50);
  const list = await listSubmissions(userId);
  const mine = list.find((s) => s.id === submission.gradeId)!;
  console.log(`Result: ${mine.company} ${mine.numericGrade} "${mine.label}"`);
  console.log(`  raw ${formatCents(mine.rawValue)} -> graded ${formatCents(mine.estimatedValue ?? mine.rawValue)}`);

  await collectGrade(userId, submission.gradeId);
  console.log('Collected; card is back in the collection.\n');

  const sale = await sellCard(userId, best.inventoryId);
  console.log(`Sold: ${sale.sold}`);
  console.log(`  graded as     ${sale.graded ?? 'NOT GRADED — BUG'}`);
  console.log(`  raw value     ${formatCents(sale.rawValue)}`);
  console.log(`  market value  ${formatCents(sale.marketValue)}`);
  console.log(`  dealer paid   ${formatCents(sale.offer)}`);

  const soldAtGradedValue = sale.marketValue !== sale.rawValue;
  const gradeIsHigh = (mine.numericGrade ?? 0) >= 9;
  console.log(`\n  sold at graded value: ${soldAtGradedValue ? 'YES' : 'NO — GRADING IS WORTHLESS'}`);
  console.log(
    `  ${gradeIsHigh ? 'high grade beat raw' : 'low grade sold below raw'}: ` +
      `${gradeIsHigh ? sale.marketValue > sale.rawValue : sale.marketValue < sale.rawValue ? 'YES' : 'NO'}`,
  );

  const audit = await auditBalance(db as never, userId);
  console.log(`\nLedger consistent: ${audit.consistent ? 'YES' : 'NO — DRIFT'}`);

  if (!soldAtGradedValue || !audit.consistent) throw new Error('Grading economics violated');
  console.log('\nGrading economics OK.');
}

runScript(main);
