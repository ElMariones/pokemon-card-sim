import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless';
import path from 'node:path';
import fs from 'node:fs';
import * as schema from './schema';

export * as schema from './schema';
export * from './schema';

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

/**
 * The connection is cached on globalThis, not in a module-level variable.
 *
 * A module-level cache is per module *instance*, and there are two ways to end
 * up with more than one: importing this file through both '@pcs/db' and a
 * relative path (the ESM loader treats those as different modules), and
 * Next.js hot reload re-evaluating the module on every edit.
 *
 * With PGlite that is not a harmless duplicate — it opens a second connection
 * to the same data directory, and writes made through one are invisible to the
 * other. That produced a silent ledger drift where a balance update appeared
 * to succeed and then vanished. globalThis is shared across all of them.
 */
const CACHE_KEY = Symbol.for('pcs.db.connection');
type GlobalWithDb = typeof globalThis & { [CACHE_KEY]?: Database };
const globalRef = globalThis as GlobalWithDb;

export const isPgliteMode = () => !process.env.DATABASE_URL;

export async function getDb(): Promise<Database> {
  const existing = globalRef[CACHE_KEY];
  if (existing) return existing;

  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import('@neondatabase/serverless');
    const db = drizzleNeon(new Pool({ connectionString: url }), { schema });
    globalRef[CACHE_KEY] = db;
    return db;
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const db = drizzlePglite(new PGlite(resolveDataDir()), { schema });
  globalRef[CACHE_KEY] = db;
  return db;
}

/**
 * Absolute path to the PGlite data directory.
 *
 * It cannot be relative to the working directory: scripts run from the repo
 * root, but Next.js runs with cwd = apps/web, so './data/pgdata' pointed at two
 * different places and the dev server silently tried to create its own empty
 * database. Anchor to the workspace root instead, found by walking up for the
 * package.json that declares workspaces.
 */
/**
 * Fail fast when another process already holds the PGlite data directory.
 *
 * PGlite allows exactly one process at a time. Without this check a second
 * process (typically a data script started while the dev server is up) simply
 * blocks forever with no output, which is indistinguishable from a slow import
 * and wastes minutes before anyone suspects a lock.
 *
 * The pid file can also be stale after a hard kill, so a pid that no longer
 * exists is cleaned up rather than reported.
 */
export function assertNotLocked(dir = resolveDataDir()): void {
  if (!isPgliteMode()) return;
  const pidFile = path.join(dir, 'postmaster.pid');
  if (!fs.existsSync(pidFile)) return;

  const pid = Number(fs.readFileSync(pidFile, 'utf8').split('\n')[0]);
  if (!Number.isFinite(pid) || pid <= 0) return;

  let alive = false;
  try {
    process.kill(pid, 0);
    alive = pid !== process.pid;
  } catch {
    alive = false;
  }

  if (alive) {
    throw new Error(
      `The database at ${dir} is held by process ${pid}.\n` +
        'PGlite allows one process at a time — stop the dev server before running data scripts.',
    );
  }

  fs.rmSync(pidFile, { force: true });
}

export function resolveDataDir(): string {
  const override = process.env.PGLITE_DATA_DIR;
  if (override) return path.resolve(override);
  return path.join(findWorkspaceRoot(), 'data', 'pgdata');
}

function findWorkspaceRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const manifest = path.join(dir, 'package.json');
    if (fs.existsSync(manifest)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { workspaces?: unknown };
        if (pkg.workspaces) return dir;
      } catch {
        // Unreadable manifest: keep walking rather than guessing.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // No workspace root found (a standalone deploy). Fall back to cwd.
  return process.cwd();
}

/** Test helper: an ephemeral in-memory database with no persistence. */
export async function getMemoryDb(): Promise<Database> {
  const { PGlite } = await import('@electric-sql/pglite');
  return drizzlePglite(new PGlite(), { schema });
}
