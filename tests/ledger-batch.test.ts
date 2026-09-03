import { beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { getMemoryDb, type Database } from '@pcs/db';
import { transactions, users } from '@pcs/db/schema';
import { applyRepeatedTransactionInTx } from '@pcs/economy-engine';
import { cents } from '@pcs/shared';

/**
 * The batched charge behind a multi-pack rip.
 *
 * Ripping fifty packs is fifty purchases, and CLAUDE.md rule 5 says every one
 * of them writes its own `transactions` row carrying the balance it produced.
 * The batch exists to avoid fifty round trips, not to collapse fifty movements
 * into one — so what these tests hold down is that the rows it writes are
 * exactly the rows a loop would have written.
 */

const USER = 'player';
const START_CASH = 10_000;
const PACK = 560;

async function freshDb(): Promise<Database> {
  const db = await getMemoryDb();
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await migrate(db as any, { migrationsFolder: './packages/db/migrations' });
  return db;
}

let db: Database;

beforeEach(async () => {
  db = await freshDb();
  await db.insert(users).values({ id: USER, cash: START_CASH });
});

const charge = (amount: number) => ({
  type: 'pack_purchase' as const,
  amount: cents(amount),
  itemType: 'pack_template',
  itemId: 'me5-booster',
});

/** Apply through a real transaction, the way the pack service does. */
function run(count: number, amount = -PACK) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return db.transaction(async (tx: any) =>
    applyRepeatedTransactionInTx(tx, USER, charge(amount), count),
  );
}

const ledger = () =>
  db.select().from(transactions).where(eq(transactions.userId, USER))
    .orderBy(asc(transactions.balanceAfter));

const cash = async () => {
  const [u] = await db.select({ cash: users.cash }).from(users).where(eq(users.id, USER));
  return u?.cash;
};

describe('applyRepeatedTransactionInTx', () => {
  it('writes one row per movement, not one row for the batch', async () => {
    const results = await run(5);

    expect(results).toHaveLength(5);
    expect(await ledger()).toHaveLength(5);
  });

  it('carries the running balance on every row', async () => {
    await run(5);

    // Descending balances, so the ascending order above reverses the sequence.
    const balances = (await ledger()).map((r) => r.balanceAfter);
    expect(balances).toEqual([
      START_CASH - PACK * 5,
      START_CASH - PACK * 4,
      START_CASH - PACK * 3,
      START_CASH - PACK * 2,
      START_CASH - PACK * 1,
    ]);
  });

  it('leaves the balance where the last movement left it', async () => {
    const results = await run(5);

    expect(await cash()).toBe(START_CASH - PACK * 5);
    expect(results[results.length - 1]!.balanceAfter).toBe(START_CASH - PACK * 5);
  });

  it('keeps the ledger consistent with the stored balance', async () => {
    await run(7);

    const total = (await ledger()).reduce((sum, r) => sum + r.amount, 0);
    expect(START_CASH + total).toBe(await cash());
  });

  /**
   * The reason sizing lives in the ledger: asking for fifty packs with cash
   * for six has to buy six, not fail and not overdraw.
   */
  it('applies the affordable prefix instead of refusing the batch', async () => {
    const affordable = Math.floor(START_CASH / PACK);
    const results = await run(affordable + 20);

    expect(results).toHaveLength(affordable);
    expect(await ledger()).toHaveLength(affordable);
    expect(await cash()).toBe(START_CASH - PACK * affordable);
  });

  it('never lets the balance go negative', async () => {
    await run(500);

    const balances = (await ledger()).map((r) => r.balanceAfter);
    expect(Math.min(...balances)).toBeGreaterThanOrEqual(0);
    expect(await cash()).toBeGreaterThanOrEqual(0);
  });

  it('writes nothing at all when even one movement is unaffordable', async () => {
    const results = await run(3, -(START_CASH + 1));

    expect(results).toEqual([]);
    expect(await ledger()).toHaveLength(0);
    expect(await cash()).toBe(START_CASH);
  });

  it('treats a count below one as no movements', async () => {
    expect(await run(0)).toEqual([]);
    expect(await ledger()).toHaveLength(0);
    expect(await cash()).toBe(START_CASH);
  });

  it('does not cap money coming in', async () => {
    const results = await run(4, 250);

    expect(results).toHaveLength(4);
    expect(await cash()).toBe(START_CASH + 1000);
  });

  it('gives every movement its own transaction id', async () => {
    const results = await run(6);

    expect(new Set(results.map((r) => r.transactionId)).size).toBe(6);
  });
});
