/**
 * End-to-end check of progression, missions and the claim guard.
 *
 * The property that matters most here: a completed mission's reward can be
 * taken exactly once. Mission progress is derived from queries, so a finished
 * mission stays finished for its whole window — without the unique claim key a
 * player could claim on a loop and mint money.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb, assertNotLocked } from '../../packages/db/src/index';
import { users } from '../../packages/db/src/schema';
import { cents, formatCents } from '../../packages/shared/src/index';
import { applyTransaction, auditBalance } from '../../packages/economy-engine/src/ledger';
import { buyAndOpenPack } from '../../apps/web/src/server/game';
import { getProgression, claimMission, MissionError } from '../../apps/web/src/server/progression-service';
import { runScript } from '../import/http';

async function main() {
  assertNotLocked();
  const db = await getDb();
  const userId = randomUUID();

  await db.insert(users).values({ id: userId, cash: 0, sessionToken: `prog-${userId}` });
  await applyTransaction(db as never, {
    userId, type: 'starting_balance', amount: cents(200_000),
  });
  console.log(`Player created with ${formatCents(cents(200_000))}\n`);

  const before = await getProgression(userId);
  console.log(`Start: level ${before.level} "${before.title}", ${before.xp} xp`);

  // Open three packs to complete the daily mission.
  for (let i = 0; i < 3; i++) {
    const r = await buyAndOpenPack(userId, 'sv3pt5');
    console.log(`  pack ${i + 1}: ${r.cards.length} cards, ${formatCents(r.totalValue)} contents`);
  }

  const after = await getProgression(userId);
  console.log(`\nAfter 3 packs: level ${after.level} "${after.title}", ${after.xp} xp`);

  const daily = after.missions.daily.find((m) => m.id === 'daily_open_3')!;
  console.log(`Mission "${daily.title}": ${daily.progress}/${daily.target} complete=${daily.complete}`);
  if (!daily.complete) throw new Error('Daily mission should be complete after 3 packs');

  const claim1 = await claimMission(userId, 'daily_open_3');
  console.log(`\nClaimed: +${formatCents(claim1.rewardCash)}, balance ${formatCents(claim1.balanceAfter)}`);

  // The guard: a second claim must be refused.
  let refused = false;
  let reason = '';
  try {
    await claimMission(userId, 'daily_open_3');
  } catch (err) {
    refused = err instanceof MissionError && err.code === 'already_claimed';
    reason = (err as Error).message;
  }
  console.log(`Second claim refused: ${refused ? 'YES' : 'NO — REWARD CAN BE FARMED'} (${reason})`);

  // An incomplete mission must also be refused.
  let incompleteRefused = false;
  try {
    await claimMission(userId, 'lt_set_1');
  } catch (err) {
    incompleteRefused = err instanceof MissionError && err.code === 'incomplete';
  }
  console.log(`Incomplete mission refused: ${incompleteRefused ? 'YES' : 'NO'}`);

  const audit = await auditBalance(db as never, userId);
  console.log(`\nLedger consistent: ${audit.consistent ? 'YES' : 'NO — DRIFT'}`);
  console.log(`  stored ${formatCents(audit.stored)}  ledger ${formatCents(audit.computed)}`);

  const final = await getProgression(userId);
  console.log(`\nFinal: level ${final.level} "${final.title}", ${final.xp} xp`);
  console.log(`  unlocks: ${final.unlocks.join(', ')}`);

  if (!refused || !incompleteRefused || !audit.consistent) {
    throw new Error('Progression invariant violated');
  }
  console.log('\nProgression OK.');
}

runScript(main);
