/** Delete the local PGlite database. Refuses to touch a remote database. */
import { rm } from 'node:fs/promises';

if (process.env.DATABASE_URL) {
  console.error('DATABASE_URL is set. Refusing to reset a remote database.');
  process.exit(1);
}

const dir = process.env.PGLITE_DATA_DIR ?? './data/pgdata';
await rm(dir, { recursive: true, force: true });
console.log(`Removed ${dir}`);
