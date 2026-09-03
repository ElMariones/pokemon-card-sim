import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getMemoryDb, type Database } from '@pcs/db';
import { minigameCosmetics, minigameRuns, transactions, users } from '@pcs/db/schema';
import { DAILY_CAP_CENTS } from '@pcs/minigame-engine';
import {
  MinigameError, buyCosmetic, earnedToday, equipCosmetic, getArcade, settleRun, startRun,
} from '../apps/web/src/server/minigame-service';

const USER = 'player';
const START_CASH = 100_000;

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

/** Wind a run's start back so a realistic amount of play appears to have happened. */
async function ageRun(runId: string, ms: number) {
  await db.update(minigameRuns)
    .set({ startedAt: new Date(Date.now() - ms) })
    .where(eq(minigameRuns.id, runId));
}

describe('startRun', () => {
  it('opens a run with a seed and reproducible content', async () => {
    const run = await startRun(USER, 'type', db);
    expect(run.runId).toBeTruthy();
    expect(run.seed).toBeTruthy();
    expect(run.content.kind).toBe('type');
  });

  it('equips the free default when the player owns nothing', async () => {
    const run = await startRun(USER, 'flappy', db);
    expect(run.equipped.id).toBe('flappy-pidgey');
  });

  it('expires an abandoned run rather than leaving it open forever', async () => {
    const first = await startRun(USER, 'flappy', db);
    await startRun(USER, 'flappy', db);

    const [stale] = await db.select().from(minigameRuns).where(eq(minigameRuns.id, first.runId));
    expect(stale?.status).toBe('expired');
  });
});

describe('settleRun', () => {
  it('pays the player and writes a ledger row', async () => {
    const run = await startRun(USER, 'flappy', db);
    await ageRun(run.runId, 45_000);

    const result = await settleRun(USER, run.runId, 20, 44_000, db);

    expect(result.payout).toBeGreaterThan(0);
    expect(result.balanceAfter).toBe(START_CASH + result.payout);

    const [row] = await db.select().from(transactions)
      .where(and(eq(transactions.userId, USER), eq(transactions.type, 'minigame_payout')));
    expect(row?.amount).toBe(result.payout);
    expect(row?.balanceAfter).toBe(result.balanceAfter);
  });

  it('refuses a replayed token', async () => {
    const run = await startRun(USER, 'flappy', db);
    await ageRun(run.runId, 45_000);
    await settleRun(USER, run.runId, 10, 44_000, db);

    await expect(settleRun(USER, run.runId, 10, 44_000, db)).rejects.toThrow(MinigameError);
  });

  it('pays only once even when a replay is attempted', async () => {
    const run = await startRun(USER, 'flappy', db);
    await ageRun(run.runId, 45_000);
    const first = await settleRun(USER, run.runId, 10, 44_000, db);
    await expect(settleRun(USER, run.runId, 10, 44_000, db)).rejects.toThrow();

    const [user] = await db.select({ cash: users.cash }).from(users).where(eq(users.id, USER));
    expect(user?.cash).toBe(START_CASH + first.payout);
  });

  it('refuses an expired run', async () => {
    const run = await startRun(USER, 'flappy', db);
    await db.update(minigameRuns)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(minigameRuns.id, run.runId));

    await expect(settleRun(USER, run.runId, 10, 44_000, db)).rejects.toThrow(/expired/i);
  });

  it("refuses another player's run", async () => {
    await db.insert(users).values({ id: 'intruder', cash: 0 });
    const run = await startRun(USER, 'flappy', db);
    await ageRun(run.runId, 45_000);

    await expect(settleRun('intruder', run.runId, 10, 44_000, db)).rejects.toThrow(MinigameError);
  });

  it('records why an impossible claim was refused', async () => {
    const run = await startRun(USER, 'flappy', db);
    await ageRun(run.runId, 5_000);

    await expect(settleRun(USER, run.runId, 900, 5_000, db)).rejects.toThrow(MinigameError);

    const [row] = await db.select().from(minigameRuns).where(eq(minigameRuns.id, run.runId));
    expect(row?.status).toBe('rejected');
    expect(row?.rejectReason).toBe('flappy_score_exceeds_spawn_rate');
  });

  it('pays nothing for a rejected claim', async () => {
    const run = await startRun(USER, 'flappy', db);
    await ageRun(run.runId, 5_000);
    await expect(settleRun(USER, run.runId, 900, 5_000, db)).rejects.toThrow();

    const [user] = await db.select({ cash: users.cash }).from(users).where(eq(users.id, USER));
    expect(user?.cash).toBe(START_CASH);
  });

  it('clamps a big win to what is left of the daily cap', async () => {
    await db.insert(transactions).values({
      id: 'seed-earning', userId: USER, type: 'minigame_payout',
      amount: DAILY_CAP_CENTS - 100, balanceAfter: START_CASH,
    });

    const run = await startRun(USER, 'flappy', db);
    await ageRun(run.runId, 120_000);
    const result = await settleRun(USER, run.runId, 100, 119_000, db);

    expect(result.payout).toBe(100);
    expect(result.capped).toBe(true);
    expect(result.capRemaining).toBe(0);
  });

  it('still records the run when the cap pays nothing', async () => {
    await db.insert(transactions).values({
      id: 'capped', userId: USER, type: 'minigame_payout',
      amount: DAILY_CAP_CENTS, balanceAfter: START_CASH,
    });

    const run = await startRun(USER, 'flappy', db);
    await ageRun(run.runId, 45_000);
    const result = await settleRun(USER, run.runId, 20, 44_000, db);

    expect(result.payout).toBe(0);
    const [row] = await db.select().from(minigameRuns).where(eq(minigameRuns.id, run.runId));
    expect(row?.status).toBe('settled');
    expect(row?.score).toBe(20);
  });
});

describe('earnedToday', () => {
  it('counts only minigame payouts', async () => {
    await db.insert(transactions).values([
      { id: 't1', userId: USER, type: 'minigame_payout', amount: 500, balanceAfter: 0 },
      { id: 't2', userId: USER, type: 'card_sale', amount: 9_000, balanceAfter: 0 },
    ]);
    expect(await earnedToday(db, USER)).toBe(500);
  });

  it('ignores a payout from before today', async () => {
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000);
    await db.insert(transactions).values({
      id: 'old', userId: USER, type: 'minigame_payout',
      amount: 9_999, balanceAfter: 0, createdAt: lastWeek,
    });
    expect(await earnedToday(db, USER)).toBe(0);
  });
});

describe('buyCosmetic', () => {
  it('charges the catalogue price and grants ownership', async () => {
    const { balanceAfter } = await buyCosmetic(USER, 'flappy-zubat', db);
    expect(balanceAfter).toBe(START_CASH - 2_500);

    const [owned] = await db.select().from(minigameCosmetics)
      .where(eq(minigameCosmetics.cosmeticId, 'flappy-zubat'));
    expect(owned?.userId).toBe(USER);
  });

  it('writes a ledger row for the purchase', async () => {
    await buyCosmetic(USER, 'flappy-zubat', db);
    const [row] = await db.select().from(transactions)
      .where(eq(transactions.type, 'cosmetic_purchase'));
    expect(row?.amount).toBe(-2_500);
    expect(row?.itemId).toBe('flappy-zubat');
  });

  it('refuses to sell the same cosmetic twice', async () => {
    await buyCosmetic(USER, 'flappy-zubat', db);
    await expect(buyCosmetic(USER, 'flappy-zubat', db)).rejects.toThrow(/already own/i);
  });

  it('refuses an unknown cosmetic id', async () => {
    await expect(buyCosmetic(USER, 'flappy-missingno', db)).rejects.toThrow(MinigameError);
  });

  it('refuses to sell a free default, which is owned by definition', async () => {
    await expect(buyCosmetic(USER, 'flappy-pidgey', db)).rejects.toThrow(/already own/i);
  });

  it('refuses when the player cannot afford it', async () => {
    await db.update(users).set({ cash: 100 }).where(eq(users.id, USER));
    await expect(buyCosmetic(USER, 'flappy-rayquaza', db)).rejects.toThrow(/afford/i);
  });

  it('leaves the balance untouched when it cannot afford it', async () => {
    await db.update(users).set({ cash: 100 }).where(eq(users.id, USER));
    await expect(buyCosmetic(USER, 'flappy-rayquaza', db)).rejects.toThrow();

    const [user] = await db.select({ cash: users.cash }).from(users).where(eq(users.id, USER));
    expect(user?.cash).toBe(100);
  });
});

describe('equipCosmetic', () => {
  it('leaves exactly one item equipped for the game', async () => {
    await buyCosmetic(USER, 'flappy-zubat', db);
    await buyCosmetic(USER, 'flappy-pikachu', db);
    await equipCosmetic(USER, 'flappy-zubat', db);
    await equipCosmetic(USER, 'flappy-pikachu', db);

    const equipped = await db.select().from(minigameCosmetics)
      .where(and(eq(minigameCosmetics.userId, USER), eq(minigameCosmetics.equipped, true)));
    expect(equipped).toHaveLength(1);
    expect(equipped[0]?.cosmeticId).toBe('flappy-pikachu');
  });

  it('is what a later run flies as', async () => {
    await buyCosmetic(USER, 'flappy-charizard', db);
    await equipCosmetic(USER, 'flappy-charizard', db);

    const run = await startRun(USER, 'flappy', db);
    expect(run.equipped.id).toBe('flappy-charizard');
    expect(run.equipped.sprite).toBe(6);
  });

  it('refuses to equip something the player does not own', async () => {
    await expect(equipCosmetic(USER, 'flappy-charizard', db)).rejects.toThrow(/own/i);
  });

  it('lets a player go back to the free default', async () => {
    await buyCosmetic(USER, 'flappy-zubat', db);
    await equipCosmetic(USER, 'flappy-zubat', db);
    await equipCosmetic(USER, 'flappy-pidgey', db);

    const run = await startRun(USER, 'flappy', db);
    expect(run.equipped.id).toBe('flappy-pidgey');
  });
});

describe('getArcade', () => {
  it('reports the best score per game and what is left of the cap', async () => {
    const run = await startRun(USER, 'flappy', db);
    await ageRun(run.runId, 45_000);
    const settled = await settleRun(USER, run.runId, 20, 44_000, db);

    const view = await getArcade(USER, db);
    const flappy = view.games.find((g) => g.game === 'flappy');
    expect(flappy?.best).toBe(20);
    expect(flappy?.earnedToday).toBe(settled.payout);
    expect(view.capRemaining).toBe(DAILY_CAP_CENTS - settled.payout);
  });

  it('marks the free defaults as owned without any rows existing', async () => {
    const view = await getArcade(USER, db);
    const pidgey = view.cosmetics.find((c) => c.id === 'flappy-pidgey');
    expect(pidgey?.owned).toBe(true);
    expect(pidgey?.equipped).toBe(true);
  });

  it('shows a bought item as owned but not yet equipped', async () => {
    await buyCosmetic(USER, 'flappy-zubat', db);
    const view = await getArcade(USER, db);
    const zubat = view.cosmetics.find((c) => c.id === 'flappy-zubat');
    expect(zubat?.owned).toBe(true);
    expect(zubat?.equipped).toBe(false);
  });
});
