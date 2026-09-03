import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'node:crypto';
import { getDb, type Database } from '@pcs/db';
import { minigameCosmetics, minigameRuns, transactions, users } from '@pcs/db/schema';
import { applyTransactionInTx, InsufficientFundsError } from '@pcs/economy-engine';
import { cents, type Cents } from '@pcs/shared';
import {
  COSMETICS, DAILY_CAP_CENTS, MINIGAME_IDS, buildContent, clampToDailyCap,
  cosmeticById, defaultCosmeticFor, payoutFor, verifyClaim,
  type Cosmetic, type MinigameContent, type MinigameId,
} from '@pcs/minigame-engine';

/**
 * The arcade's server half.
 *
 * This is the only module that turns a score into money, and it is written on
 * the assumption that the number it was handed is a lie. A skill game cannot be
 * fully server-authoritative — only the browser knows whether the player
 * cleared the obstacle — so instead of pretending otherwise, four things bound
 * what a lie is worth:
 *
 *   1. A run is a row, single-use, consumed under a lock. Replay is impossible.
 *   2. Elapsed time comes from the server's own clock, never the client's.
 *   3. Content is rebuilt from the seed, so a claim is checked against what was
 *      actually achievable.
 *   4. The daily cap limits what even a perfect forgery can collect.
 *
 * See docs/superpowers/specs/2026-09-03-minigames-arcade-design.md.
 */

const RUN_TTL_MS = 15 * 60 * 1_000;

export class MinigameError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'MinigameError';
  }
}

export interface StartedRun {
  runId: string;
  seed: string;
  content: MinigameContent;
  equipped: Cosmetic;
  capRemaining: Cents;
  best: number;
}

export interface SettledRun {
  score: number;
  payout: Cents;
  balanceAfter: Cents;
  capRemaining: Cents;
  /** True when the cap, not the curve, decided the payout. */
  capped: boolean;
  best: number;
}

export interface ArcadeGameView {
  game: MinigameId;
  best: number;
  earnedToday: Cents;
  playsToday: number;
}

export interface ArcadeCosmeticView extends Cosmetic {
  owned: boolean;
  equipped: boolean;
}

export interface ArcadeView {
  games: ArcadeGameView[];
  cosmetics: ArcadeCosmeticView[];
  earnedToday: Cents;
  capRemaining: Cents;
  dailyCap: Cents;
}

/** Midnight UTC today. The cap is a UTC day so it does not shift with travel. */
function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * What the arcade has already paid this player today.
 *
 * Computed from the ledger, never kept in a counter. A counter drifts when a
 * request fails halfway and nothing can repair it afterwards; a query derived
 * from the same rows the rest of the game reads cannot drift at all. This is
 * the same reasoning missions use for progress.
 */
export async function earnedToday(db: Database, userId: string): Promise<Cents> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${transactions.amount}), 0)::int` })
    .from(transactions)
    .where(and(
      eq(transactions.userId, userId),
      eq(transactions.type, 'minigame_payout'),
      gte(transactions.createdAt, startOfUtcDay()),
    ));
  return cents(Number(row?.total ?? 0));
}

/** The player's best settled score for a game, or 0 if they have never played. */
async function bestScore(db: Database, userId: string, game: MinigameId): Promise<number> {
  const [row] = await db
    .select({ score: minigameRuns.score })
    .from(minigameRuns)
    .where(and(
      eq(minigameRuns.userId, userId),
      eq(minigameRuns.game, game),
      eq(minigameRuns.status, 'settled'),
    ))
    .orderBy(desc(minigameRuns.score))
    .limit(1);
  return row?.score ?? 0;
}

/**
 * What the player flies, flips, or types on.
 *
 * The free default is never stored as a row — owning nothing for a game *is*
 * owning the default. That is why a brand new player needs no seeding, and why
 * un-equipping back to the default is just deleting the equipped flag.
 */
async function equippedFor(db: Database, userId: string, game: MinigameId): Promise<Cosmetic> {
  const [row] = await db
    .select({ cosmeticId: minigameCosmetics.cosmeticId })
    .from(minigameCosmetics)
    .where(and(
      eq(minigameCosmetics.userId, userId),
      eq(minigameCosmetics.game, game),
      eq(minigameCosmetics.equipped, true),
    ))
    .limit(1);

  const chosen = row ? cosmeticById(row.cosmeticId) : undefined;
  return chosen ?? defaultCosmeticFor(game);
}

/**
 * Open a run.
 *
 * Any run the player abandoned for this game is expired first. Without that,
 * a player could hold several open tokens and settle the one whose start time
 * flatters the score they intend to claim.
 */
export async function startRun(
  userId: string,
  game: MinigameId,
  database?: Database,
): Promise<StartedRun> {
  const db = database ?? (await getDb());
  const now = new Date();

  await db
    .update(minigameRuns)
    .set({ status: 'expired' })
    .where(and(
      eq(minigameRuns.userId, userId),
      eq(minigameRuns.game, game),
      eq(minigameRuns.status, 'open'),
    ));

  const runId = randomUUID();
  const seed = randomBytes(12).toString('hex');

  await db.insert(minigameRuns).values({
    id: runId,
    userId,
    game,
    seed,
    status: 'open',
    startedAt: now,
    expiresAt: new Date(now.getTime() + RUN_TTL_MS),
  });

  const [equipped, earned, best] = await Promise.all([
    equippedFor(db, userId, game),
    earnedToday(db, userId),
    bestScore(db, userId, game),
  ]);

  return {
    runId,
    seed,
    content: buildContent(game, seed),
    equipped,
    capRemaining: cents(Math.max(0, DAILY_CAP_CENTS - earned)),
    best,
  };
}

/**
 * Settle a run and pay for it.
 *
 * Everything that decides money happens inside one database transaction, with
 * the run row locked, so two requests carrying the same token cannot both find
 * it open.
 */
export async function settleRun(
  userId: string,
  runId: string,
  score: number,
  durationMs: number,
  database?: Database,
): Promise<SettledRun> {
  const db = database ?? (await getDb());

  /**
   * The transaction *returns* a refusal rather than throwing one.
   *
   * Throwing from inside `db.transaction` rolls the whole thing back, which
   * would take the rejection record with it — the run would be left open, and
   * the audit trail this design leans on would quietly not exist. So every
   * outcome commits, and the error is raised afterwards.
   */
  type Outcome =
    | { kind: 'refused'; message: string; code: string }
    | {
        kind: 'settled'; game: MinigameId; score: number; payout: Cents;
        balanceAfter: Cents; capped: boolean; capRemaining: Cents;
      };

  const outcome: Outcome = await db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(minigameRuns)
      .where(eq(minigameRuns.id, runId))
      .for('update')
      .limit(1);

    // A missing run and someone else's run give the same answer on purpose:
    // confirming that a stranger's run id exists is free information.
    if (!run || run.userId !== userId) {
      return { kind: 'refused', message: 'No such run', code: 'run_not_found' };
    }
    if (run.status !== 'open') {
      return {
        kind: 'refused',
        message: 'That run has already been settled',
        code: 'run_already_settled',
      };
    }
    if (run.expiresAt.getTime() < Date.now()) {
      await tx.update(minigameRuns)
        .set({ status: 'expired' })
        .where(eq(minigameRuns.id, runId));
      return { kind: 'refused', message: 'That run has expired', code: 'run_expired' };
    }

    const game = run.game as MinigameId;
    const serverElapsedMs = Date.now() - run.startedAt.getTime();
    const verdict = verifyClaim({
      game,
      score,
      durationMs,
      serverElapsedMs,
      content: buildContent(game, run.seed),
    });

    if (!verdict.ok) {
      // Kept, not deleted. A rejected claim is the only trace anyone would
      // have that the scheme is being probed.
      await tx.update(minigameRuns)
        .set({
          status: 'rejected',
          score,
          durationMs: Math.round(durationMs),
          rejectReason: verdict.reason,
          settledAt: new Date(),
        })
        .where(eq(minigameRuns.id, runId));
      return {
        kind: 'refused',
        message: 'That score could not be verified',
        code: verdict.reason,
      };
    }

    const earned = await earnedToday(tx as unknown as Database, userId);
    const earnedCurve = payoutFor(game, score);
    const payout = clampToDailyCap(earnedCurve, earned);

    let balanceAfter: Cents;
    if (payout > 0) {
      const result = await applyTransactionInTx(tx, {
        userId,
        type: 'minigame_payout',
        amount: payout,
        itemType: 'minigame',
        itemId: game,
        metadata: { runId, score },
      });
      balanceAfter = result.balanceAfter;
    } else {
      // Nothing moved, so there is no ledger row to take a balance from — but
      // the caller still needs one to render. Read it through the schema like
      // every other query here rather than hand-writing SQL.
      const [row] = await tx
        .select({ cash: users.cash })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      balanceAfter = cents(row?.cash ?? 0);
    }

    await tx.update(minigameRuns)
      .set({
        status: 'settled',
        score,
        durationMs: Math.round(durationMs),
        payout,
        settledAt: new Date(),
      })
      .where(eq(minigameRuns.id, runId));

    return {
      kind: 'settled',
      game,
      score,
      payout,
      balanceAfter,
      capped: payout < earnedCurve,
      capRemaining: cents(Math.max(0, DAILY_CAP_CENTS - earned - payout)),
    };
  });

  if (outcome.kind === 'refused') throw new MinigameError(outcome.message, outcome.code);

  return {
    score: outcome.score,
    payout: outcome.payout,
    balanceAfter: outcome.balanceAfter,
    capRemaining: outcome.capRemaining,
    capped: outcome.capped,
    best: await bestScore(db, userId, outcome.game),
  };
}

/** Ids the player has actually bought. The free defaults are never among them. */
async function ownedIds(db: Database, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ cosmeticId: minigameCosmetics.cosmeticId })
    .from(minigameCosmetics)
    .where(eq(minigameCosmetics.userId, userId));
  return new Set(rows.map((r) => r.cosmeticId));
}

/**
 * Buy a cosmetic.
 *
 * The price is resolved from the catalogue by id. The request carries an id
 * and nothing else, so there is no number in it that could be tampered with.
 */
export async function buyCosmetic(
  userId: string,
  cosmeticId: string,
  database?: Database,
): Promise<{ balanceAfter: Cents; cosmetic: Cosmetic }> {
  const db = database ?? (await getDb());

  const cosmetic = cosmeticById(cosmeticId);
  if (!cosmetic) throw new MinigameError('No such item', 'cosmetic_not_found');
  if (cosmetic.price === 0) {
    throw new MinigameError('You already own that', 'cosmetic_already_owned');
  }

  const owned = await ownedIds(db, userId);
  if (owned.has(cosmeticId)) {
    throw new MinigameError('You already own that', 'cosmetic_already_owned');
  }

  try {
    return await db.transaction(async (tx) => {
      const result = await applyTransactionInTx(tx, {
        userId,
        type: 'cosmetic_purchase',
        amount: cents(-cosmetic.price),
        itemType: 'cosmetic',
        itemId: cosmetic.id,
        metadata: { game: cosmetic.game, name: cosmetic.name },
      });

      await tx.insert(minigameCosmetics).values({
        id: randomUUID(),
        userId,
        cosmeticId: cosmetic.id,
        game: cosmetic.game,
        equipped: false,
      });

      return { balanceAfter: result.balanceAfter, cosmetic };
    });
  } catch (err) {
    if (err instanceof InsufficientFundsError) {
      throw new MinigameError('You cannot afford that yet', 'insufficient_funds');
    }
    // A concurrent duplicate loses the unique index race rather than a check.
    if (err instanceof Error && /minigame_cosmetics_user_item_uq/.test(err.message)) {
      throw new MinigameError('You already own that', 'cosmetic_already_owned');
    }
    throw err;
  }
}

/**
 * Equip a cosmetic.
 *
 * Clearing first and setting second is the order the partial unique index
 * requires — the opposite order would momentarily leave two rows equipped for
 * the same game and be refused by the database.
 */
export async function equipCosmetic(
  userId: string,
  cosmeticId: string,
  database?: Database,
): Promise<{ equipped: Cosmetic }> {
  const db = database ?? (await getDb());

  const cosmetic = cosmeticById(cosmeticId);
  if (!cosmetic) throw new MinigameError('No such item', 'cosmetic_not_found');

  const owned = await ownedIds(db, userId);
  const isFreeDefault = cosmetic.price === 0;
  if (!isFreeDefault && !owned.has(cosmeticId)) {
    throw new MinigameError('You do not own that yet', 'cosmetic_not_owned');
  }

  await db.transaction(async (tx) => {
    await tx
      .update(minigameCosmetics)
      .set({ equipped: false })
      .where(and(
        eq(minigameCosmetics.userId, userId),
        eq(minigameCosmetics.game, cosmetic.game),
      ));

    // The free default has no row, so equipping it is exactly "nothing is
    // equipped" — the clear above already did the whole job.
    if (!isFreeDefault) {
      await tx
        .update(minigameCosmetics)
        .set({ equipped: true })
        .where(and(
          eq(minigameCosmetics.userId, userId),
          eq(minigameCosmetics.cosmeticId, cosmeticId),
        ));
    }
  });

  return { equipped: cosmetic };
}

/** Everything the hub and the shop need, in one round trip. */
export async function getArcade(userId: string, database?: Database): Promise<ArcadeView> {
  const db = database ?? (await getDb());
  const since = startOfUtcDay();

  const [owned, earned, perGame] = await Promise.all([
    ownedIds(db, userId),
    earnedToday(db, userId),
    db
      .select({
        game: minigameRuns.game,
        best: sql<number>`coalesce(max(${minigameRuns.score}), 0)::int`,
        plays: sql<number>`count(*) filter (where ${minigameRuns.startedAt} >= ${since})::int`,
        earned: sql<number>`coalesce(sum(${minigameRuns.payout}) filter (where ${minigameRuns.startedAt} >= ${since}), 0)::int`,
      })
      .from(minigameRuns)
      .where(and(
        eq(minigameRuns.userId, userId),
        eq(minigameRuns.status, 'settled'),
        inArray(minigameRuns.game, MINIGAME_IDS as unknown as string[]),
      ))
      .groupBy(minigameRuns.game),
  ]);

  const equippedRows = await db
    .select({ cosmeticId: minigameCosmetics.cosmeticId, game: minigameCosmetics.game })
    .from(minigameCosmetics)
    .where(and(eq(minigameCosmetics.userId, userId), eq(minigameCosmetics.equipped, true)));
  const equippedByGame = new Map(equippedRows.map((r) => [r.game, r.cosmeticId]));

  const games: ArcadeGameView[] = MINIGAME_IDS.map((game) => {
    const row = perGame.find((r) => r.game === game);
    return {
      game,
      best: Number(row?.best ?? 0),
      earnedToday: cents(Number(row?.earned ?? 0)),
      playsToday: Number(row?.plays ?? 0),
    };
  });

  const cosmetics: ArcadeCosmeticView[] = COSMETICS.map((c) => {
    const isDefault = c.price === 0;
    const equippedId = equippedByGame.get(c.game);
    return {
      ...c,
      owned: isDefault || owned.has(c.id),
      // Nothing equipped for a game means the free default is what is in use.
      equipped: equippedId ? equippedId === c.id : isDefault,
    };
  });

  return {
    games,
    cosmetics,
    earnedToday: earned,
    capRemaining: cents(Math.max(0, DAILY_CAP_CENTS - earned)),
    dailyCap: cents(DAILY_CAP_CENTS),
  };
}
