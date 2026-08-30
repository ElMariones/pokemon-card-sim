import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless';
import * as schema from './schema.js';

export * as schema from './schema.js';
export * from './schema.js';

/**
 * One database, two drivers.
 *
 * Dev runs PGlite: real Postgres compiled to WebAssembly, persisted to
 * ./data/pgdata. No Docker, no install, and — critically — the same SQL
 * dialect as production, so a query that works locally works on Neon.
 *
 * Set DATABASE_URL to switch to Neon. Nothing else changes.
 */
export type Database =
  | ReturnType<typeof drizzlePglite<typeof schema>>
  | ReturnType<typeof drizzleNeon<typeof schema>>;

let cached: Database | undefined;

export const isPgliteMode = () => !process.env.DATABASE_URL;

export async function getDb(): Promise<Database> {
  if (cached) return cached;

  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import('@neondatabase/serverless');
    cached = drizzleNeon(new Pool({ connectionString: url }), { schema });
    return cached;
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const dataDir = process.env.PGLITE_DATA_DIR ?? './data/pgdata';
  cached = drizzlePglite(new PGlite(dataDir), { schema });
  return cached;
}

/** Test helper: an ephemeral in-memory database with no persistence. */
export async function getMemoryDb(): Promise<Database> {
  const { PGlite } = await import('@electric-sql/pglite');
  return drizzlePglite(new PGlite(), { schema });
}
