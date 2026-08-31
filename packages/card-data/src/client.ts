import { getDb, type Database } from '../../db/src/index.js';

/**
 * Every query in this package takes an optional database handle and falls back
 * to the process-wide one. Tests pass an in-memory PGlite; the web app passes
 * nothing and gets the shared connection.
 *
 * `Database` is a union of the PGlite and Neon drizzle types. They expose the
 * same query builder over the same dialect, but TypeScript will not resolve a
 * call signature across a union of two distinct generic classes, so queries
 * are written against the shared `PgDatabase` view of it.
 */
export type CardDataDb = Database;

export async function resolveDb(db?: CardDataDb): Promise<Database> {
  return db ?? (await getDb());
}

/** Postgres returns count(*) as a bigint, which the drivers hand back as text. */
export function toCount(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number.parseInt(value, 10) || 0;
  return 0;
}
