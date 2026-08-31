/** Delete the local PGlite database. Refuses to touch a remote database. */
import { rm } from 'node:fs/promises';
import { resolveDataDir } from '../../packages/db/src/index';

if (process.env.DATABASE_URL) {
  console.error('DATABASE_URL is set. Refusing to reset a remote database.');
  process.exit(1);
}

const dir = resolveDataDir();
await rm(dir, { recursive: true, force: true });
console.log(`Removed ${dir}`);
