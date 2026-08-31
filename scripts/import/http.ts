/**
 * Shared fetch helpers for the importers.
 *
 * The bulk catalogue lives on raw.githubusercontent.com and has no rate limit.
 * Prices come from api.pokemontcg.io, which does, so every request through
 * here retries on 429 and 5xx with exponential backoff and honours
 * Retry-After when the server sends one.
 */

const USER_AGENT = 'pokemon-card-sim/0.1 (+https://github.com/ElMariones/pokemon-card-sim)';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FetchOptions {
  retries?: number;
  baseDelayMs?: number;
  headers?: Record<string, string>;
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const { retries = 5, baseDelayMs = 1000 } = opts;

  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, ...opts.headers };
  const apiKey = process.env.POKEMONTCG_API_KEY;
  if (apiKey && url.includes('api.pokemontcg.io')) headers['X-Api-Key'] = apiKey;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });

      if (res.ok) return (await res.json()) as T;

      // 404 on a per-set card file is a real answer, not a transient failure.
      if (res.status === 404) throw new NotFoundError(url);

      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : baseDelayMs * 2 ** attempt;
        if (attempt < retries) {
          console.warn(`  ${res.status} on ${shortUrl(url)}, retrying in ${Math.round(wait / 1000)}s`);
          await sleep(wait);
          continue;
        }
      }

      throw new Error(`HTTP ${res.status} for ${url}`);
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      lastError = err;
      if (attempt < retries) {
        await sleep(baseDelayMs * 2 ** attempt);
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
}

export class NotFoundError extends Error {
  constructor(url: string) {
    super(`Not found: ${url}`);
    this.name = 'NotFoundError';
  }
}

const shortUrl = (u: string) => u.replace(/^https?:\/\/[^/]+/, '');

/**
 * The source publishes dates as `1999/01/09`. Postgres and every comparison we
 * do want `1999-01-09`, and sorting the raw form works only by accident.
 */
export function normalizeDate(input: string | null | undefined): string {
  if (!input) return '';
  const m = /^(\d{4})[/-](\d{2})[/-](\d{2})/.exec(input.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : input.trim();
}

/** Split an array into fixed-size chunks for batched inserts. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Minimal `--flag=value` / `--flag` parser. */
export function parseArgs(argv = process.argv.slice(2)): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const arg of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (m && m[1]) out[m[1]] = m[2] ?? true;
  }
  return out;
}

/**
 * Run a script's main function and exit deterministically.
 *
 * PGlite holds the event loop open after the work is done, so a script that
 * simply returns from main() never exits. Every importer ends here.
 */
export function runScript(main: () => Promise<void>): void {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
