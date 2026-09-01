import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '@pcs/db/schema';
import { findGradeableCards } from '../apps/web/src/server/grading-service';

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
});
