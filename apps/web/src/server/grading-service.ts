import { randomUUID } from 'node:crypto';
import { and, eq, desc, notExists } from 'drizzle-orm';
import { getDb, type Database } from '@pcs/db';
import { grades, inventoryItems, cards, sets } from '@pcs/db/schema';
import { cents, type Cents, type Condition } from '@pcs/shared';
import {
  SERVICE_TIERS, rollGrade, gradedValue, mulberry32, computePrice,
  applyTransaction, InsufficientFundsError, bulkGradingFee, type GradeResult,
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
/**
 * Read at call time, not at module load. A module-level constant captures
 * whatever the environment held when the module was first imported, which
 * silently ignores anything set afterwards — including by a test harness.
 */
export const gradingSecondsPerHour = (): number =>
  Number(process.env.GRADING_SECONDS_PER_HOUR ?? 5);

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

/** A physical copy that has never received a grade and may be submitted. */
export interface GradeableCard {
  inventoryId: string;
  name: string;
  number: string;
  imageSmall: string | null;
  marketBasePrice: Cents | null;
  rarityTier: string;
  setName: string;
}

/**
 * Query candidates by inventory ID, not card metadata. Two copies of the same
 * Charizard remain distinct: a grade on one copy never disqualifies the other.
 */
export async function findGradeableCards(db: Database, userId: string): Promise<GradeableCard[]> {
  const rows = await db
    .select({
      inventoryId: inventoryItems.id,
      name: cards.name,
      number: cards.number,
      imageSmall: cards.imageSmall,
      marketBasePrice: cards.marketBasePrice,
      rarityTier: cards.rarityTier,
      setName: sets.name,
    })
    .from(inventoryItems)
    .leftJoin(cards, eq(cards.id, inventoryItems.cardId))
    .leftJoin(sets, eq(sets.id, cards.setId))
    .where(and(
      eq(inventoryItems.userId, userId),
      eq(inventoryItems.status, 'owned'),
      notExists(
        db.select({ id: grades.id })
          .from(grades)
          .where(eq(grades.inventoryItemId, inventoryItems.id)),
      ),
    ))
    .orderBy(desc(inventoryItems.acquiredAt));

  return rows.map((row) => ({
    inventoryId: row.inventoryId,
    name: row.name ?? '',
    number: row.number ?? '',
    imageSmall: row.imageSmall,
    marketBasePrice: row.marketBasePrice === null ? null : cents(row.marketBasePrice),
    rarityTier: row.rarityTier ?? 'common',
    setName: row.setName ?? '',
  }));
}

export async function listGradeableCards(userId: string): Promise<GradeableCard[]> {
  return findGradeableCards(await getDb(), userId);
}

export async function submitForGrading(
  userId: string,
  inventoryId: string,
  serviceTierId: string,
) {
  const r = await submitForGradingBulk(userId, [inventoryId], serviceTierId);
  return {
    gradeId: r.gradeIds[0]!,
    gradeIds: r.gradeIds,
    cardName: r.cards[0]?.cardName ?? '',
    cards: r.cards,
    company: r.company,
    tierName: r.tierName,
    fee: r.fee,
    singleFee: r.singleFee,
    count: 1,
    readyAt: r.readyAt,
    secondsRemaining: r.secondsRemaining,
    balanceAfter: r.balanceAfter,
  };
}

export async function submitForGradingBulk(
  userId: string,
  inventoryIds: string[],
  serviceTierId: string,
) {
  const db = await getDb();
  const tier = SERVICE_TIERS.find((t) => t.id === serviceTierId);
  if (!tier) throw new GameError(`No such service tier: ${serviceTierId}`, 'bad_tier');

  const ids = [...new Set(inventoryIds.filter(Boolean))];
  if (ids.length === 0) throw new GameError('Select at least one card', 'no_cards');
  if (ids.length > 20) throw new GameError('At most 20 cards per submission', 'too_many');

  const { inArray } = await import('drizzle-orm');
  const items = await db
    .select({
      id: inventoryItems.id,
      status: inventoryItems.status,
      condition: inventoryItems.condition,
      cardName: cards.name,
      basePrice: cards.marketBasePrice,
      existingGradeId: grades.id,
    })
    .from(inventoryItems)
    .leftJoin(cards, eq(cards.id, inventoryItems.cardId))
    .leftJoin(grades, eq(grades.inventoryItemId, inventoryItems.id))
    .where(and(eq(inventoryItems.userId, userId), inArray(inventoryItems.id, ids)));

  if (items.length !== ids.length) throw new GameError('You do not own every selected card', 'not_owned');
  for (const it of items) {
    if (it.status !== 'owned') throw new GameError(`Card ${it.cardName ?? it.id} is not available`, 'not_available');
    if (it.existingGradeId) {
      throw new GameError(`Card ${it.cardName ?? it.id} has already been graded`, 'already_graded');
    }
    const condition = (it.condition ?? 'near_mint') as Condition;
    const rawValue = computePrice(cents(it.basePrice ?? 0), { condition });
    if (rawValue > tier.maxDeclaredValue) {
      throw new GameError(
        `${it.cardName ?? it.id}: ${tier.name} does not accept cards above ${tier.maxDeclaredValue / 100} in value (raw ${rawValue / 100})`,
        'value_too_high',
      );
    }
  }

  const bulkFee = bulkGradingFee(tier.fee, ids.length);

  // Charge the (bulk) fee first; if the player cannot afford it nothing else happens.
  let balanceAfter: Cents;
  try {
    const txRes = await applyTransaction(db as never, {
      userId,
      type: 'grading_fee',
      amount: cents(-bulkFee),
      itemType: 'grading',
      itemId: ids.length === 1 ? ids[0] : undefined,
      metadata: {
        tier: tier.id,
        company: tier.company,
        count: ids.length,
        singleFee: tier.fee,
        bulkFee,
        inventoryIds: ids,
      },
    });
    balanceAfter = txRes.balanceAfter;
  } catch (err) {
    if (err instanceof InsufficientFundsError) {
      throw new GameError('Not enough cash for that grading tier', 'insufficient_funds');
    }
    throw err;
  }

  const rng = mulberry32((Date.now() ^ Math.floor(Math.random() * 2 ** 31)) >>> 0);
  const readyAt = new Date(
    Date.now() + tier.turnaroundHours * gradingSecondsPerHour() * 1000,
  );

  const gradeIds: string[] = [];
  const cardsOut: { inventoryId: string; cardName: string; grade: import('@pcs/economy-engine').GradeResult }[] = [];
  let gemCount = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.transaction(async (tx: any) => {
    for (const it of items) {
      const condition = (it.condition ?? 'near_mint') as Condition;
      const result = rollGrade(tier.company, condition, rng);
      if (result.numericGrade === 10) gemCount++;
      const gradeId = randomUUID();
      gradeIds.push(gradeId);
      cardsOut.push({ inventoryId: it.id, cardName: it.cardName ?? '', grade: result });
      await tx.insert(grades).values({
        id: gradeId,
        userId,
        inventoryItemId: it.id,
        gradeCompany: tier.company,
        serviceTier: tier.id,
        numericGrade: result.numericGrade,
        label: result.label,
        submissionFee: tier.fee,
        status: 'queued',
        readyAt,
      });
      await tx
        .update(inventoryItems)
        .set({ status: 'grading', gradingId: gradeId })
        .where(eq(inventoryItems.id, it.id));
    }
  });

  await grantXp(userId, 'card_graded', ids.length);
  if (gemCount > 0) await grantXp(userId, 'gem_mint_pulled', gemCount);

  return {
    gradeIds,
    cards: cardsOut,
    cardName: cardsOut[0]?.cardName ?? '',
    company: tier.company,
    tierName: tier.name,
    fee: bulkFee,
    singleFee: tier.fee,
    count: ids.length,
    readyAt: readyAt.toISOString(),
    secondsRemaining: Math.ceil((readyAt.getTime() - Date.now()) / 1000),
    balanceAfter: balanceAfter!,
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    realSecondsToComplete: t.turnaroundHours * gradingSecondsPerHour(),
  }));
