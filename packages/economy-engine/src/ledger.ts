import { eq, sql } from 'drizzle-orm';
import { cents, type Cents } from '../../shared/src/index';
import { users, transactions } from '../../db/src/schema';
import { randomUUID } from 'node:crypto';

/**
 * The money ledger (DESIGN.md section 22).
 *
 * A balance is not a number we keep somewhere convenient — it is the result of
 * applying every transaction. Each movement writes a row recording the signed
 * amount and the balance it produced, so the whole history is auditable and a
 * discrepancy is findable.
 *
 * Every mutation goes through applyTransaction. Nothing else may write
 * `users.cash`.
 */

export type TransactionType =
  | 'starting_balance'
  | 'pack_purchase'
  | 'card_sale'
  | 'card_purchase'
  | 'grading_fee'
  | 'sealed_purchase'
  | 'sealed_sale'
  | 'mission_reward'
  | 'level_reward'
  | 'minigame_payout'
  | 'cosmetic_purchase';

export class InsufficientFundsError extends Error {
  constructor(readonly balance: Cents, readonly required: Cents) {
    super(`Insufficient funds: balance ${balance}, required ${required}`);
    this.name = 'InsufficientFundsError';
  }
}

export interface TransactionInput {
  userId: string;
  type: TransactionType;
  /** Signed. Negative means money leaving the player. */
  amount: Cents;
  itemType?: string;
  itemId?: string;
  metadata?: Record<string, unknown>;
}

export interface TransactionResult {
  transactionId: string;
  balanceAfter: Cents;
}

/** Transaction-shaped subset used when a larger economic action owns the transaction. */
export interface LedgerTransaction {
  select: any;
  update: any;
  insert: any;
}

/** Minimal structural type so this module does not depend on a driver. */
interface LedgerDb {
  transaction<T>(fn: (tx: any) => Promise<T>): Promise<T>;
}

/**
 * Apply one money movement atomically.
 *
 * The balance update and the ledger row are written in a single database
 * transaction. The balance is read inside that transaction so two concurrent
 * requests cannot both see the same starting balance and overdraw.
 */
export async function applyTransaction(
  db: LedgerDb,
  input: TransactionInput,
): Promise<TransactionResult> {
  return db.transaction(async (tx) => applyTransactionInTx(tx, input));
}

/**
 * Apply a ledger movement inside an existing transaction.
 *
 * Mixed card-and-cash trades must commit the debit, traded cards and purchased
 * card together. Opening a nested transaction here would allow those pieces to
 * diverge on drivers that do not provide true savepoints.
 */
export async function applyTransactionInTx(
  tx: LedgerTransaction,
  input: TransactionInput,
): Promise<TransactionResult> {
  const [row] = await tx
    .select({ cash: users.cash })
    .from(users)
    .where(eq(users.id, input.userId))
    .for('update')
    .limit(1);

  if (!row) throw new Error(`No such user: ${input.userId}`);

  const balance = cents(row.cash);
  const next = cents(balance + input.amount);

  if (next < 0) {
    throw new InsufficientFundsError(balance, cents(-input.amount));
  }

  await tx.update(users).set({ cash: next }).where(eq(users.id, input.userId));

  const transactionId = randomUUID();
  await tx.insert(transactions).values({
    id: transactionId,
    userId: input.userId,
    type: input.type,
    amount: input.amount,
    balanceAfter: next,
    itemType: input.itemType ?? null,
    itemId: input.itemId ?? null,
    metadata: input.metadata ?? null,
  });

  return { transactionId, balanceAfter: next };
}

/**
 * Apply several movements for one user inside an existing transaction.
 *
 * Ripping fifty packs is fifty purchases, and the ledger must show fifty rows
 * (DESIGN.md section 22) — but it does not have to make fifty round trips to
 * find out the same balance fifty times. The row is read and locked once, each
 * movement is applied to the running balance in order, and the rows are
 * written in one insert. The result is byte-identical to calling
 * applyTransactionInTx in a loop.
 *
 * Rejects the whole batch if any prefix would overdraw, so a caller that wants
 * "as many as they can afford" must size the batch itself.
 */
export async function applyTransactionsInTx(
  tx: LedgerTransaction,
  userId: string,
  inputs: readonly Omit<TransactionInput, 'userId'>[],
): Promise<TransactionResult[]> {
  if (inputs.length === 0) return [];

  const [row] = await tx
    .select({ cash: users.cash })
    .from(users)
    .where(eq(users.id, userId))
    .for('update')
    .limit(1);

  if (!row) throw new Error(`No such user: ${userId}`);

  let balance = cents(row.cash);
  const results: TransactionResult[] = [];
  const rows: (typeof transactions.$inferInsert)[] = [];

  for (const input of inputs) {
    const next = cents(balance + input.amount);
    if (next < 0) throw new InsufficientFundsError(balance, cents(-input.amount));
    balance = next;

    const transactionId = randomUUID();
    results.push({ transactionId, balanceAfter: next });
    rows.push({
      id: transactionId,
      userId,
      type: input.type,
      amount: input.amount,
      balanceAfter: next,
      itemType: input.itemType ?? null,
      itemId: input.itemId ?? null,
      metadata: input.metadata ?? null,
    });
  }

  await tx.update(users).set({ cash: balance }).where(eq(users.id, userId));
  await tx.insert(transactions).values(rows);

  return results;
}

/**
 * Recompute a balance from the ledger and compare it to the stored value.
 * Any drift means something wrote `users.cash` without going through here.
 */
export async function auditBalance(
  db: { select: any },
  userId: string,
): Promise<{ stored: Cents; computed: Cents; consistent: boolean }> {
  const [u] = await db
    .select({ cash: users.cash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const [sum] = await db
    .select({ total: sql<number>`coalesce(sum(amount), 0)::int` })
    .from(transactions)
    .where(eq(transactions.userId, userId));

  const stored = cents(u?.cash ?? 0);
  const computed = cents(Number(sum?.total ?? 0));
  return { stored, computed, consistent: stored === computed };
}
