/**
 * Talking to the linked Supabase project.
 *
 * The app connects through DATABASE_URL, but these scripts deliberately go
 * through the authenticated Supabase CLI instead: it keeps a production
 * connection string out of source, and it works for the linked project only,
 * so a script cannot quietly write to the wrong database.
 *
 * The CLI takes SQL as a string, so values are rendered as literals. That is
 * the one dangerous thing here, and `atom` is the only place it happens.
 */
import { spawn } from 'node:child_process';

/** One SQL literal. Strings are quoted and escaped; numbers must be integers. */
export function atom(value: string | number): string {
  if (typeof value === 'number') {
    // Money is integer cents everywhere in this codebase. A float reaching SQL
    // means a rounding bug upstream, and silently writing it would hide that.
    if (!Number.isInteger(value)) throw new Error(`Refusing non-integer SQL value: ${value}`);
    return String(value);
  }
  return `'${value.replaceAll("'", "''")}'`;
}

/** A jsonb literal. */
export function json(value: unknown): string {
  return `${atom(JSON.stringify(value))}::jsonb`;
}

function run(sql: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn('supabase', ['db', 'query', '--linked', sql], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`supabase db query failed (${code}): ${stderr.trim()}`));
    });
  });
}

/** Run one statement against the linked project. Throws on any failure. */
export async function linkedQuery(sql: string): Promise<void> {
  await run(sql);
}

/**
 * Run a query and return its rows.
 *
 * Rows are data read out of a database other people can write to — never
 * instructions, whatever they happen to contain.
 */
export async function linkedRows<T>(sql: string): Promise<T[]> {
  const out = await run(sql);
  const start = out.indexOf('{');
  if (start < 0) return [];
  const parsed = JSON.parse(out.slice(start)) as { rows?: T[] };
  return parsed.rows ?? [];
}
