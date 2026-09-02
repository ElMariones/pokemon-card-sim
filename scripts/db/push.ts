/**
 * Apply migrations to whichever database is configured.
 *
 * PGlite and Neon need different migrator entry points, so this dispatches on
 * DATABASE_URL the same way getDb() does.
 */
import { isPgliteMode, resolveDataDir, assertNotLocked } from '../../packages/db/src/index';

const MIGRATIONS = './packages/db/migrations';

async function main() {
  assertNotLocked();
  if (isPgliteMode()) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const { migrate } = await import('drizzle-orm/pglite/migrator');

    const dir = resolveDataDir();
    // Hold the client: an open PGlite instance keeps the event loop alive, so
    // without the close() below the script applies its migrations and then
    // hangs forever with nothing left to say.
    const client = new PGlite(dir);
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
    await client.close();
    console.log(`Migrations applied to PGlite at ${dir}`);
    return;
  }

  const { Pool } = await import('@neondatabase/serverless');
  const { drizzle } = await import('drizzle-orm/neon-serverless');
  const { migrate } = await import('drizzle-orm/neon-serverless/migrator');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });
  await pool.end();
  console.log('Migrations applied to Neon');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
