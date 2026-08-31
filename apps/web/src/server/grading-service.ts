import { randomUUID } from 'node:crypto';
import { and, eq, sql, desc } from 'drizzle-orm';
import { getDb } from '@pcs/db';
import { grades, inventoryItems, cards } from '@pcs/db/schema';
import { cents, type Cents, type Condition } from '@pcs/shared';
import {
  SERVICE_TIERS, rollGrade, gradedValue, mulberry32, computePrice,
  applyTransaction, InsufficientFundsError, type GradeResult,
} from '@pcs/economy-engine';
import { GameError } from './game';
import { grantXp } from './progression-service';

/**
 * Grading submissions.
 *
 * The grade is rolled and stored at submission time, not at collection time.
 * Both are equally safe against a client that cannot see the database, but
 * fixing the outcome up front means the result is auditable: it cannot be
 * influenced by anything that happens while the card is in the queue.
 *
 * Turnaround is compressed. A real PSA Value submission takes days; waiting
 * days in a browser game is not a mechanic, it is an exit. One in-game hour
 * runs in GRADING_SECONDS_PER_HOUR real seconds, so the slowest tier lands in
 * about eight minutes — long enough that the choice to grade costs you
 * liquidity for a while, short enough to matter within one session.
 */
export const GRADING_SECONDS_PER_HOUR = Number(process.env.GRADING_SECONDS_PER_HOUR ?? 5);

export interface SubmissionView {
  id: string;
  cardName: string;
  imageSmall: string | null;
  company: string;
  tierName: string;
  fee: Cents;
  status: 'queued' | 'ready' | 'completed';
  readyAt: string;
  secondsRemaining: number;
  numericGrade: number | null;
  label: string | null;
  estimatedValue: Cents | null;
  rawValue: Cents;
}

export async function submitForGrading(
  userId: string,
  inventoryId: string,
  serviceTierId: string,
) {
  const db = await getDb();
  const tier = SERVICE_TIERS.find((t) => t.id === serviceTierId);
  if (!tier) throw new GameError(`No such service tier: ${serviceTierId}`, 'bad_tier');

  const [item] = await db
    .select({
      id: inventoryItems.id,
      status: inventoryItems.status,
      condition: inventoryItems.condition,
      cardName: cards.name,
      basePrice: cards.marketBasePrice,
    })
    .from(inventoryItems)
    .leftJoin(cards, eq(cards.id, inventoryItems.cardId))
    .where(and(eq(inventoryItems.id, inventoryId), eq(inventoryItems.userId, userId)))
    .limit(1);

  if (!item) throw new GameError('You do not own that card', 'not_owned');
  if (item.status !== 'owned') throw new GameError('That card is not available', 'not_available');

  const condition = (item.condition ?? 'near_mint') as Condition;
  const rawValue = computePrice(cents(item.basePrice ?? 0), { condition });

  if (rawValue > tier.maxDeclaredValue) {
    throw new GameError(
      `${tier.name} does not accept cards above ${tier.maxDeclaredValue / 100} in value`,
      'value_too_high',
    );
  }

  // Charge the fee first; if the player cannot afford it nothing else happens.
  try {
    await applyTransaction(db as never, {
      userId,
      type: 'grading_fee',
      amount: cents(-tier.fee),
      itemType: 'grading',
      itemId: inventoryId,
      metadata: { tier: tier.id, company: tier.company },
    });
  } catch (err) {
    if (err instanceof InsufficientFundsError) {
      throw new GameError('Not enough cash for that grading tier', 'insufficient_funds');
    }
    throw err;
  }

  const rng = mulberry32((Date.now() ^ Math.floor(Math.random() * 2 ** 31)) >>> 0);
  const result = rollGrade(tier.company, condition, rng);

  const readyAt = new Date(
    Date.now() + tier.turnaroundHours * GRADING_SECONDS_PER_HOUR * 1000,
  );
  const gradeId = randomUUID();

  await db.transaction(async (tx: any) => {
    await tx.insert(grades).values({
      id: gradeId,
      userId,
      inventoryItemId: inventoryId,
      gradeCompany: tier.company,
      serviceTier: tier.id,
      numericGrade: result.numericGrade,
      label: result.label,
      submissionFee: tier.fee,
      status: 'queued',
      readyAt,
    });
    // The card leaves the collection while it is away, exactly as it would in
    // real life. It cannot be sold from the queue.
    await tx
      .update(inventoryItems)
      .set({ status: 'grading', gradingId: gradeId })
      .where(eq(inventoryItems.id, inventoryId));
  });

  await grantXp(userId, 'card_graded');
  if (result.numericGrade === 10) await grantXp(userId, 'gem_mint_pulled');

  return {
    gradeId,
    cardName: item.cardName ?? '',
    company: tier.company,
    tierName: tier.name,
    fee: tier.fee,
    readyAt: readyAt.toISOString(),
    secondsRemaining: Math.ceil((readyAt.getTime() - Date.now()) / 1000),
  };
}

/** The player's submissions. The grade stays hidden until the timer elapses. */
export async function listSubmissions(userId: string): Promise<SubmissionView[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: grades.id,
      company: grades.gradeCompany,
      serviceTier: grades.serviceTier,
      fee: grades.submissionFee,
      status: grades.status,
      readyAt: grades.readyAt,
      numericGrade: grades.numericGrade,
      label: grades.label,
      cardName: cards.name,
      imageSmall: cards.imageSmall,
      basePrice: cards.marketBasePrice,
      condition: inventoryItems.condition,
    })
    .from(grades)
    .leftJoin(inventoryItems, eq(inventoryItems.id, grades.inventoryItemId))
    .leftJoin(cards, eq(cards.id, inventoryItems.cardId))
    .where(eq(grades.userId, userId))
    .orderBy(desc(grades.submittedAt));

  const now = Date.now();

  return rows.map((r) => {
    const ready = new Date(r.readyAt).getTime();
    const remaining = Math.max(0, Math.ceil((ready - now) / 1000));
    const revealed = remaining === 0;
    const tier = SERVICE_TIERS.find((t) => t.id === r.serviceTier);
    const rawValue = computePrice(cents(r.basePrice ?? 0), {
      condition: (r.condition ?? 'near_mint') as Condition,
    });

    const grade: GradeResult | null =
      revealed && r.numericGrade != null
        ? {
            company: r.company as GradeResult['company'],
            numericGrade: r.numericGrade,
            label: r.label ?? '',
            isBlackLabel: (r.label ?? '').includes('Black Label'),
          }
        : null;

    return {
      id: r.id,
      cardName: r.cardName ?? '',
      imageSmall: r.imageSmall,
      company: r.company,
      tierName: tier?.name ?? r.serviceTier,
      fee: cents(r.fee),
      status: r.status === 'completed' ? 'completed' : revealed ? 'ready' : 'queued',
      readyAt: new Date(r.readyAt).toISOString(),
      secondsRemaining: remaining,
      // Hidden until the timer elapses. The client is never sent an unrevealed
      // grade, so it cannot be read out of the network response early.
      numericGrade: revealed ? r.numericGrade : null,
      label: revealed ? r.label : null,
      estimatedValue: grade ? gradedValue(rawValue, grade) : null,
      rawValue,
    } satisfies SubmissionView;
  });
}

/** Take delivery of a finished grade; the card returns to the collection. */
export async function collectGrade(userId: string, gradeId: string) {
  const db = await getDb();

  const [row] = await db
    .select({
      id: grades.id,
      status: grades.status,
      readyAt: grades.readyAt,
      numericGrade: grades.numericGrade,
      label: grades.label,
      company: grades.gradeCompany,
      inventoryItemId: grades.inventoryItemId,
    })
    .from(grades)
    .where(and(eq(grades.id, gradeId), eq(grades.userId, userId)))
    .limit(1);

  if (!row) throw new GameError('No such submission', 'not_found');
  if (row.status === 'completed') throw new GameError('Already collected', 'already_collected');
  if (new Date(row.readyAt).getTime() > Date.now()) {
    throw new GameError('That card is still being graded', 'not_ready');
  }

  await db.transaction(async (tx: any) => {
    await tx
      .update(grades)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(grades.id, gradeId));
    await tx
      .update(inventoryItems)
      .set({ status: 'owned' })
      .where(eq(inventoryItems.id, row.inventoryItemId));
  });

  return {
    gradeId,
    company: row.company,
    numericGrade: row.numericGrade,
    label: row.label,
  };
}

export const listServiceTiers = () =>
  SERVICE_TIERS.map((t) => ({
    ...t,
    realSecondsToComplete: t.turnaroundHours * GRADING_SECONDS_PER_HOUR,
  }));
