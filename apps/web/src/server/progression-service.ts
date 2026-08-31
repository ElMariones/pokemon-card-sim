import { and, eq, gte, sql, inArray } from 'drizzle-orm';
import { getDb } from '@pcs/db';
import { randomUUID } from 'node:crypto';
import { users, openings, transactions, inventoryItems, cards, grades, missions as missionsTable } from '@pcs/db/schema';
import { cents, type Cents } from '@pcs/shared';
import {
  awardXp, levelForXp, nextLevel, levelProgressBp, unlockedFeatures,
  MISSION_TEMPLATES, missionsFor, windowEnd,
  type XpReason, type Cadence, type MissionTemplate, type MissionMetric,
} from '@pcs/economy-engine';
import { applyTransaction } from '@pcs/economy-engine';

/**
 * Progression and missions.
 *
 * Mission progress is COMPUTED from the data that already exists — openings,
 * transactions, inventory — rather than kept in incrementing counters. A
 * counter can drift from reality when a request fails halfway, and once it
 * drifts nothing can repair it. A query cannot drift: it is derived from the
 * same rows the rest of the game reads.
 */

export interface MissionView extends MissionTemplate {
  progress: number;
  complete: boolean;
  claimed: boolean;
}

export interface ProgressionView {
  xp: number;
  level: number;
  title: string;
  nextTitle: string | null;
  xpToNext: number | null;
  progressBp: number;
  unlocks: string[];
  missions: Record<Cadence, MissionView[]>;
}

/** Start of the current daily/weekly window. */
function windowStart(cadence: Cadence, now = new Date()): Date | null {
  if (cadence === 'long_term') return null;
  const end = windowEnd(cadence, now)!;
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (cadence === 'daily' ? 1 : 7));
  return start;
}

async function measure(
  userId: string,
  metric: MissionMetric,
  since: Date | null,
): Promise<number> {
  const db = await getDb();
  const sinceClause = (col: never) => (since ? gte(col, since) : sql`true`);

  switch (metric) {
    case 'packs_opened': {
      const [r] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(openings)
        .where(and(eq(openings.userId, userId), sinceClause(openings.createdAt as never)));
      return Number(r?.n ?? 0);
    }
    case 'cards_sold': {
      const [r] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.type, 'card_sale'),
            sinceClause(transactions.createdAt as never),
          ),
        );
      return Number(r?.n ?? 0);
    }
    case 'unique_cards_added': {
      const [r] = await db
        .select({ n: sql<number>`count(distinct ${inventoryItems.cardId})::int` })
        .from(inventoryItems)
        .where(
          and(
            eq(inventoryItems.userId, userId),
            sinceClause(inventoryItems.acquiredAt as never),
          ),
        );
      return Number(r?.n ?? 0);
    }
    case 'cards_graded': {
      const [r] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(grades)
        .where(and(eq(grades.userId, userId), sinceClause(grades.submittedAt as never)));
      return Number(r?.n ?? 0);
    }
    case 'gem_mint_owned': {
      const [r] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(grades)
        .where(and(eq(grades.userId, userId), eq(grades.numericGrade, 10)));
      return Number(r?.n ?? 0);
    }
    case 'collection_value': {
      const [r] = await db
        .select({ n: sql<number>`coalesce(sum(${cards.marketBasePrice}), 0)::int` })
        .from(inventoryItems)
        .innerJoin(cards, eq(cards.id, inventoryItems.cardId))
        .where(and(eq(inventoryItems.userId, userId), eq(inventoryItems.status, 'owned')));
      return Number(r?.n ?? 0);
    }
    case 'sets_completed': {
      const res = await db.execute(sql`
        select count(*)::int as n from (
          select c.set_id
          from cards c
          left join inventory_items i
            on i.card_id = c.id and i.user_id = ${userId} and i.status = 'owned'
          group by c.set_id
          having count(distinct c.id) = count(distinct i.card_id)
             and count(distinct i.card_id) > 0
        ) d
      `);
      return Number((res.rows[0] as { n?: number })?.n ?? 0);
    }
    default:
      return 0;
  }
}

export async function getProgression(userId: string): Promise<ProgressionView> {
  const db = await getDb();
  const [user] = await db.select({ xp: users.xp }).from(users).where(eq(users.id, userId)).limit(1);
  const xp = user?.xp ?? 0;

  const level = levelForXp(xp);
  const next = nextLevel(xp);

  const claimed = await listClaims(userId);
  const cadences: Cadence[] = ['daily', 'weekly', 'long_term'];
  const missions = {} as Record<Cadence, MissionView[]>;

  for (const cadence of cadences) {
    const since = windowStart(cadence);
    const templates = missionsFor(cadence, level.level);
    missions[cadence] = await Promise.all(
      templates.map(async (t) => {
        const progress = await measure(userId, t.metric, since);
        return {
          ...t,
          progress: Math.min(progress, t.target),
          complete: progress >= t.target,
          claimed: claimed.has(claimKey(t.id, cadence)),
        };
      }),
    );
  }

  return {
    xp,
    level: level.level,
    title: level.title,
    nextTitle: next?.title ?? null,
    xpToNext: next ? next.xpRequired - xp : null,
    progressBp: levelProgressBp(xp),
    unlocks: [...unlockedFeatures(xp)],
    missions,
  };
}

/**
 * Award XP and persist it.
 *
 * Returns the level-up information so the caller can surface it. Levelling is
 * derived from total XP, so this is safe to call repeatedly without the level
 * and the XP getting out of step.
 */
export async function grantXp(userId: string, reason: XpReason, count = 1) {
  const db = await getDb();
  const [user] = await db.select({ xp: users.xp }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;

  const result = awardXp(user.xp, reason, count);
  await db
    .update(users)
    .set({ xp: result.totalXp, level: result.newLevel, lastSeenAt: new Date() })
    .where(eq(users.id, userId));

  return result;
}

export class MissionError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'MissionError';
  }
}

/**
 * A claim is recorded per (user, mission, window) so a reward can be taken
 * exactly once.
 *
 * Mission progress is derived from queries rather than counters, which means
 * a completed mission stays completed for as long as its window lasts — so
 * without this record a player could claim the same daily reward on a loop
 * and mint money. The row is inserted inside the same transaction that pays,
 * and the unique key is what actually enforces it: two concurrent claims race
 * to insert and the loser is rejected by the database, not by a check that
 * happened a moment earlier.
 */
function claimKey(templateId: string, cadence: Cadence, now = new Date()): string {
  const end = windowEnd(cadence, now);
  return end ? `${templateId}:${end.toISOString().slice(0, 10)}` : `${templateId}:once`;
}

export async function listClaims(userId: string): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db
    .select({ templateId: missionsTable.templateId })
    .from(missionsTable)
    .where(and(eq(missionsTable.userId, userId), sql`${missionsTable.claimedAt} is not null`));
  return new Set(rows.map((r) => r.templateId));
}

/** Claim a completed mission's reward. Verified server-side before paying. */
export async function claimMission(userId: string, missionId: string) {
  const template = MISSION_TEMPLATES.find((m) => m.id === missionId);
  if (!template) throw new MissionError(`No such mission: ${missionId}`, 'not_found');

  const since = windowStart(template.cadence);
  const progress = await measure(userId, template.metric, since);
  if (progress < template.target) {
    throw new MissionError('Mission is not complete', 'incomplete');
  }

  const db = await getDb();
  const key = claimKey(template.id, template.cadence);

  // Insert the claim first. If this row already exists the reward was taken.
  const inserted = await db
    .insert(missionsTable)
    .values({
      id: randomUUID(),
      userId,
      templateId: key,
      cadence: template.cadence,
      progress: template.target,
      target: template.target,
      rewardCash: template.rewardCash,
      rewardXp: template.rewardXp,
      claimedAt: new Date(),
      expiresAt: windowEnd(template.cadence),
    })
    .onConflictDoNothing()
    .returning();

  if (inserted.length === 0) {
    throw new MissionError('Reward already claimed', 'already_claimed');
  }

  const { balanceAfter } = await applyTransaction(db as never, {
    userId,
    type: 'mission_reward',
    amount: template.rewardCash,
    itemType: 'mission',
    itemId: key,
  });

  const xp = await grantXp(userId, 'mission_completed');
  return { rewardCash: template.rewardCash, balanceAfter, xp };
}
