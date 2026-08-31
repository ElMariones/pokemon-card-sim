/**
 * Import market prices from the pokemontcg.io API.
 *
 * Unlike the catalogue, prices only exist on the live API, which is rate
 * limited — so this pages per set with a delay, is resumable, and records
 * where every figure came from.
 *
 * Cards the sources do not cover keep `market_base_price = null` and
 * confidence 'unknown'. We never invent a number (DESIGN.md section 5).
 *
 *   npx tsx scripts/import/import-prices.ts --set=base1
 *   npx tsx scripts/import/import-prices.ts --era=sv
 *   npx tsx scripts/import/import-prices.ts --missing --limit=30
 */
import { sql, eq, inArray } from 'drizzle-orm';
import { getDb } from '../../packages/db/src/index';
import { sets, cards, marketState } from '../../packages/db/src/schema';
import { selectBasePrice, type PriceSourceCard } from '../../packages/card-data/src/price-selection';
import { fetchJson, chunk, parseArgs, sleep, runScript } from './http';

const PAGE_SIZE = 250;
const DELAY_MS = Number(process.env.PRICE_DELAY_MS ?? 700);

interface ApiCard extends PriceSourceCard {
  id: string;
}
interface ApiPage {
  data: ApiCard[];
  page: number;
  pageSize: number;
  totalCount: number;
}

const excluded = (c: string) => sql.raw(`excluded.${c}`);

async function fetchSetPrices(setId: string): Promise<ApiCard[]> {
  const out: ApiCard[] = [];
  for (let page = 1; ; page++) {
    const url =
      `https://api.pokemontcg.io/v2/cards?q=set.id:${encodeURIComponent(setId)}` +
      `&pageSize=${PAGE_SIZE}&page=${page}&select=id,tcgplayer,cardmarket`;
    // The upstream API returns intermittent 500/502s that clear on retry, so
    // this is deliberately more patient than the catalogue fetches.
    const res = await fetchJson<ApiPage>(url, { retries: 8, baseDelayMs: 1500 });
    out.push(...(res.data ?? []));
    if (!res.data?.length || out.length >= (res.totalCount ?? 0)) break;
    await sleep(DELAY_MS);
  }
  return out;
}

async function main() {
  const args = parseArgs();
  const db = await getDb();

  let setRows = await db
    .select({ id: sets.id, name: sets.name, era: sets.era })
    .from(sets)
    .orderBy(sql`release_date desc`);

  if (typeof args.set === 'string') setRows = setRows.filter((s) => s.id === args.set);
  if (typeof args.era === 'string') setRows = setRows.filter((s) => s.era === args.era);

  if (args.missing) {
    const done = await db
      .select({ setId: cards.setId, n: sql<number>`count(market_base_price)::int` })
      .from(cards)
      .groupBy(cards.setId);
    const have = new Set(done.filter((d) => Number(d.n) > 0).map((d) => d.setId));
    setRows = setRows.filter((s) => !have.has(s.id));
  }

  if (typeof args.limit === 'string') setRows = setRows.slice(0, Number(args.limit));

  console.log(`Fetching prices for ${setRows.length} sets (delay ${DELAY_MS}ms)...\n`);

  let totalPriced = 0;
  let totalSeen = 0;

  for (const [i, set] of setRows.entries()) {
    const label = `[${String(i + 1).padStart(3)}/${setRows.length}] ${set.id}`;
    let apiCards: ApiCard[];
    try {
      apiCards = await fetchSetPrices(set.id);
    } catch (err) {
      console.error(`${label} FAILED: ${(err as Error).message}`);
      continue;
    }

    const now = new Date();
    let priced = 0;
    const marketRows: { cardId: string; currentPrice: number }[] = [];

    for (const batch of chunk(apiCards, 200)) {
      for (const c of batch) {
        const sel = selectBasePrice(c);
        if (sel.price === null) continue;
        priced++;
        marketRows.push({ cardId: c.id, currentPrice: sel.price });
        await db
          .update(cards)
          .set({
            marketBasePrice: sel.price,
            priceConfidence: sel.confidence,
            priceUpdatedAt: now,
          })
          .where(eq(cards.id, c.id));
      }
    }

    // Seed market state so the simulation has somewhere to drift from.
    for (const batch of chunk(marketRows, 300)) {
      await db
        .insert(marketState)
        .values(batch.map((r) => ({ cardId: r.cardId, currentPrice: r.currentPrice, updatedAt: now })))
        .onConflictDoUpdate({
          target: marketState.cardId,
          set: { currentPrice: excluded('current_price'), updatedAt: now },
        });
    }

    totalPriced += priced;
    totalSeen += apiCards.length;
    console.log(
      `${label} ${String(priced).padStart(4)}/${String(apiCards.length).padEnd(4)} priced  ${set.name}`,
    );
    await sleep(DELAY_MS);
  }

  console.log(`\nPriced ${totalPriced} of ${totalSeen} cards seen.`);
  console.log('Cards without a source price keep market_base_price = null (confidence: unknown).');
}

runScript(main);
