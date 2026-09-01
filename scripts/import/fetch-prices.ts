/**
 * Fetch raw price data to disk. Touches the network, never the database.
 *
 * This is split from apply-prices for two reasons:
 *
 *  1. The upstream API is slow and intermittently 500s, so a full run takes
 *     hours. PGlite allows exactly one process to hold the data directory, so
 *     an importer that also wrote to the database would lock out the dev
 *     server for that entire time.
 *  2. Re-applying is then free. Fixing a bug in price selection means re-running
 *     apply-prices over the cache, not re-downloading 174 sets.
 *
 *   npx tsx scripts/import/fetch-prices.ts            # everything missing
 *   npx tsx scripts/import/fetch-prices.ts --force    # refetch even if cached
 *   npx tsx scripts/import/fetch-prices.ts --set=base1
 */
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fetchJson, sleep, parseArgs, runScript } from './http';

const PAGE_SIZE = 250;
const DELAY_MS = Number(process.env.PRICE_DELAY_MS ?? 600);
const CACHE_DIR = path.resolve('data/raw/prices');
const SETS_URL =
  'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/sets/en.json';

interface ApiPage {
  data: unknown[];
  totalCount?: number;
}

const exists = (p: string) => access(p).then(() => true, () => false);

async function fetchSet(setId: string): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let page = 1; ; page++) {
    // Do not use the API's `select` parameter here. Its current projection of
    // `tcgplayer`/`cardmarket` keeps only each URL and silently drops the
    // nested `prices` block, leaving every card unpriced. Full records are
    // larger, but price data is the sole reason this importer exists.
    const url =
      `https://api.pokemontcg.io/v2/cards?q=set.id:${encodeURIComponent(setId)}` +
      `&pageSize=${PAGE_SIZE}&page=${page}`;
    const res = await fetchJson<ApiPage>(url, { retries: 8, baseDelayMs: 1500 });
    out.push(...(res.data ?? []));
    if (!res.data?.length || out.length >= (res.totalCount ?? 0)) break;
    await sleep(DELAY_MS);
  }
  return out;
}

async function main() {
  const args = parseArgs();
  await mkdir(CACHE_DIR, { recursive: true });

  const allSets = await fetchJson<{ id: string; name: string; releaseDate?: string }[]>(SETS_URL);

  // Newest first: modern sets are the ones players reach for.
  let targets = [...allSets].sort((a, b) =>
    (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''),
  );
  if (typeof args.set === 'string') targets = targets.filter((s) => s.id === args.set);
  if (typeof args.limit === 'string') targets = targets.slice(0, Number(args.limit));

  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (const [i, set] of targets.entries()) {
    const file = path.join(CACHE_DIR, `${set.id}.json`);
    const label = `[${String(i + 1).padStart(3)}/${targets.length}] ${set.id.padEnd(10)}`;

    if (!args.force && (await exists(file))) {
      skipped++;
      continue;
    }

    try {
      const cards = await fetchSet(set.id);
      await writeFile(file, JSON.stringify(cards));
      fetched++;
      console.log(`${label} ${String(cards.length).padStart(4)} cards  ${set.name}`);
    } catch (err) {
      failed++;
      console.error(`${label} FAILED: ${(err as Error).message}`);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nFetched ${fetched}, already cached ${skipped}, failed ${failed}.`);
  console.log(`Cache: ${CACHE_DIR}`);
  console.log('Now run: npm run data:apply-prices');
}

runScript(main);
