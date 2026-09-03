import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '@pcs/db/schema';
import { collectReadyGrades, findGradeableCards } from '../apps/web/src/server/grading-service';

describe('grading candidates', () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: path.resolve('packages/db/migrations') });

    await db.insert(schema.sets).values({
      id: 'test-set', name: 'Test Set', series: 'Test', era: 'sv',
      releaseDate: '2026-01-01', printedTotal: 1, total: 1, source: 'test',
    });
    await db.insert(schema.users).values({ id: 'player', cash: 100_000, sessionToken: 'player-session' });
    await db.insert(schema.cards).values({
      id: 'charizard-ex', setId: 'test-set', number: '006', name: 'Charizard ex',
      rarityTier: 'ultra_rare', source: 'test',
    });
    await db.insert(schema.inventoryItems).values([
      {
        id: 'charizard-graded', userId: 'player', type: 'card', cardId: 'charizard-ex', quantity: 1,
        condition: 'near_mint', acquisitionSource: 'pack', acquisitionPrice: 0, status: 'owned',
      },
      {
        id: 'charizard-raw', userId: 'player', type: 'card', cardId: 'charizard-ex', quantity: 1,
        condition: 'near_mint', acquisitionSource: 'pack', acquisitionPrice: 0, status: 'owned',
      },
    ]);
    await db.insert(schema.grades).values({
      id: 'psa-grade', userId: 'player', inventoryItemId: 'charizard-graded', gradeCompany: 'PSA',
      serviceTier: 'psa-value', numericGrade: 10, label: 'Gem Mint', submissionFee: 2_500,
      status: 'completed', readyAt: new Date('2026-01-02T00:00:00Z'),
    });
  });

  afterEach(async () => {
    await client.close();
  });

  it('keeps an ungraded copy gradeable when an identical copy is already graded', async () => {
    const candidates = await findGradeableCards(db, 'player');

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      inventoryId: 'charizard-raw',
      name: 'Charizard ex',
      number: '006',
    });
  });

  it('does not allow the already graded physical copy to receive another grade', async () => {
    await expect(db.insert(schema.grades).values({
      id: 'second-psa-grade', userId: 'player', inventoryItemId: 'charizard-graded', gradeCompany: 'PSA',
      serviceTier: 'psa-value', numericGrade: 9, label: 'Mint', submissionFee: 2_500,
      status: 'completed', readyAt: new Date('2026-01-03T00:00:00Z'),
    })).rejects.toThrow();
  });

  it('collects every ready physical copy together and leaves queued cards alone', async () => {
    const past = new Date(Date.now() - 1_000);
    const future = new Date(Date.now() + 60_000);
    await db.insert(schema.inventoryItems).values([
      {
        id: 'ready-a', userId: 'player', type: 'card', cardId: 'charizard-ex', quantity: 1,
        condition: 'near_mint', acquisitionSource: 'pack', acquisitionPrice: 0, status: 'grading',
      },
      {
        id: 'ready-b', userId: 'player', type: 'card', cardId: 'charizard-ex', quantity: 1,
        condition: 'near_mint', acquisitionSource: 'pack', acquisitionPrice: 0, status: 'grading',
      },
      {
        id: 'still-queued', userId: 'player', type: 'card', cardId: 'charizard-ex', quantity: 1,
        condition: 'near_mint', acquisitionSource: 'pack', acquisitionPrice: 0, status: 'grading',
      },
    ]);
    await db.insert(schema.grades).values([
      { id: 'grade-ready-a', userId: 'player', inventoryItemId: 'ready-a', gradeCompany: 'PSA', serviceTier: 'psa-value', numericGrade: 9, label: 'Mint', submissionFee: 2_500, status: 'queued', readyAt: past },
      { id: 'grade-ready-b', userId: 'player', inventoryItemId: 'ready-b', gradeCompany: 'PSA', serviceTier: 'psa-value', numericGrade: 10, label: 'Gem Mint', submissionFee: 2_500, status: 'queued', readyAt: past },
      { id: 'grade-waiting', userId: 'player', inventoryItemId: 'still-queued', gradeCompany: 'PSA', serviceTier: 'psa-value', numericGrade: 8, label: 'Near Mint-Mint', submissionFee: 2_500, status: 'queued', readyAt: future },
    ]);

    const result = await collectReadyGrades('player', db);
    expect(result.collectedCount).toBe(2);
    expect(result.grades.map((grade) => grade.gradeId).sort()).toEqual(['grade-ready-a', 'grade-ready-b']);

    const items = await db.select({ id: schema.inventoryItems.id, status: schema.inventoryItems.status })
      .from(schema.inventoryItems)
      .where(inArray(schema.inventoryItems.id, ['ready-a', 'ready-b', 'still-queued']));
    expect(Object.fromEntries(items.map((item) => [item.id, item.status]))).toEqual({
      'ready-a': 'owned',
      'ready-b': 'owned',
      'still-queued': 'grading',
    });

    await expect(collectReadyGrades('player', db)).resolves.toMatchObject({ collectedCount: 0 });
  });
});
