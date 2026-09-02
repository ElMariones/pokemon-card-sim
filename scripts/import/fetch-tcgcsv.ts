/**
 * Fetch TCGplayer's price feed to disk. Touches the network, never the database.
 *
 * Source: tcgcsv.com, a daily mirror of the same feed api.pokemontcg.io
 * republishes. Two things it has that the API does not: the 2026 sets, whose
 * cards the API ships with no price block at all, and sealed products — which
 * is where a pack's real price comes from.
 *
 * The cache is reduced to what pricing needs (identity, collector number,
 * price rows) rather than stored verbatim: the raw products payload carries
 * full card text and is two orders of magnitude larger for no benefit.
 *
 *   npx tsx scripts/import/fetch-tcgcsv.ts             # everything missing
 *   npx tsx scripts/import/fetch-tcgcsv.ts --force     # refetch everything
 *   npx tsx scripts/import/fetch-tcgcsv.ts --group=604
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { cardNumberOf, type TcgcsvPrice, type TcgcsvProduct } from '../../packages/card-data/src/tcgcsv';
import { fetchJson, sleep, parseArgs, runScript } from './http';

/** Pokémon. The category ids are stable and published at /tcgplayer/categories. */
const CATEGORY = 3;
const BASE = 'https://tcgcsv.com/tcgplayer';
const CACHE_DIR = path.resolve('data/raw/tcgcsv');
/** Polite spacing. The mirror answers a burst with a non-JSON holding page. */
const DELAY_MS = Number(process.env.TCGCSV_DELAY_MS ?? 250);

interface GroupResponse {
  results: { groupId: number; name: string; abbreviation?: string | null; publishedOn?: string }[];
}
interface ProductResponse { results: TcgcsvProduct[] }
interface PriceResponse { results: TcgcsvPrice[] }

/** What we keep per group: enough to price singles and to find the booster pack. */
export interface GroupCache {
  groupId: number;
  name: string;
  abbreviation: string | null;
  fetchedAt: string;
  products: { productId: number; name: string; url: string | null; number: string | null }[];
  prices: TcgcsvPrice[];
}

const exists = (p: string) => access(p).then(() => true, () => false);

async function main() {
  const args = parseArgs();
  const force = Boolean(args.force);
  await mkdir(CACHE_DIR, { recursive: true });

  console.log('Fetching TCGplayer group list...');
  const groups = await fetchJson<GroupResponse>(`${BASE}/${CATEGORY}/groups`, { retries: 8 });
  await writeFile(path.join(CACHE_DIR, 'groups.json'), JSON.stringify(groups.results, null, 1));
  console.log(`  ${groups.results.length} groups`);

  const only = args.group !== undefined ? Number(args.group) : null;
  const targets = only === null ? groups.results : groups.results.filter((g) => g.groupId === only);

  let fetched = 0;
  let skipped = 0;

  for (const group of targets) {
    const file = path.join(CACHE_DIR, `${group.groupId}.json`);
    if (!force && (await exists(file))) { skipped++; continue; }

    // A rate-limited response is HTML, so JSON.parse throws and fetchJson
    // retries it with backoff. That is the intended path, not an error.
    const products = await fetchJson<ProductResponse>(`${BASE}/${CATEGORY}/${group.groupId}/products`, { retries: 8, baseDelayMs: 1500 });
    await sleep(DELAY_MS);
    const prices = await fetchJson<PriceResponse>(`${BASE}/${CATEGORY}/${group.groupId}/prices`, { retries: 8, baseDelayMs: 1500 });

    const cache: GroupCache = {
      groupId: group.groupId,
      name: group.name,
      abbreviation: group.abbreviation ?? null,
      fetchedAt: new Date().toISOString(),
      products: products.results.map((p) => ({
        productId: p.productId,
        name: p.name,
        url: p.url ?? null,
        number: cardNumberOf(p),
      })),
      prices: prices.results,
    };
    await writeFile(file, JSON.stringify(cache));
    fetched++;
    if (fetched % 25 === 0) console.log(`  ${fetched} fetched...`);
    await sleep(DELAY_MS);
  }

  console.log(`\nFetched ${fetched} groups, ${skipped} already cached, in ${CACHE_DIR}`);
  if (skipped > 0 && !force) console.log('Pass --force to refresh prices that are already on disk.');
}

runScript(main);
