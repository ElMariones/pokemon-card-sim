/**
 * Apply cached price data to the database. Touches the database, never the
 * network. Fast, so it can run between dev-server sessions.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql, eq, inArray } from 'drizzle-orm';
import { getDb, assertNotLocked } from '../../packages/db/src/index';
import { cards, marketState } from '../../packages/db/src/schema';
import { selectBasePrice, type PriceSourceCard } from '../../packages/card-data/src/price-selection';
import { chunk, parseArgs, runScript } from './http';

const CACHE_DIR = path.resolve('data/raw/prices');
const excluded = (c: string) => sql.raw(`excluded.${c}`);

interface CachedCard extends PriceSourceCard {
  id: string;
}

async function main() {
  assertNotLocked();
  const args = parseArgs();
  const db = await getDb();

  let files: string[];
  try {
    files = (await readdir(CACHE_DIR)).filter((f) => f.endsWith('.json'));
  } catch {
    throw new Error(`No price cache at ${CACHE_DIR}. Run fetch-prices first.`);
  }
  if (typeof args.set === 'string') files = files.filter((f) => f === `${args.set}.json`);

  console.log(`Applying prices from ${files.length} cached sets...\n`);

  const now = new Date();
  let priced = 0;
  let unpriced = 0;
  let orphaned = 0;

  for (const file of files) {
    const setId = file.replace(/\.json$/, '');
    let cached: CachedCard[];
    try {
      cached = JSON.parse(await readFile(path.join(CACHE_DIR, file), 'utf8'));
    } catch (err) {
      console.error(`  ${setId}: unreadable cache (${(err as Error).message})`);
      continue;
    }

    // The live price API carries sets and cards the bulk catalogue dataset does
    // not yet have — the GitHub export lags the API. Writing those straight in
    // violates the market_state foreign key, so prices are restricted to cards
    // we actually hold and the difference is reported rather than swallowed.
    const known = new Set(
      (
        await db.select({ id: cards.id }).from(cards).where(eq(cards.setId, setId))
      ).map((r) => r.id),
    );

    const updates: { id: string; price: number; confidence: string }[] = [];
    for (const c of cached) {
      const sel = selectBasePrice(c);
      if (sel.price === null) { unpriced++; continue; }
      if (!known.has(c.id)) { orphaned++; continue; }
      updates.push({ id: c.id, price: sel.price, confidence: sel.confidence });
    }

    // One statement per chunk rather than one per card: a per-card UPDATE over
    // 20k cards is thousands of round trips and takes minutes.
    for (const batch of chunk(updates, 500)) {
      if (batch.length === 0) continue;
      const values = batch
        .map((u) => `('${u.id.replace(/'/g, "''")}', ${u.price}, '${u.confidence}')`)
        .join(',');
      await db.execute(
        sql.raw(`
          update cards as c
          set market_base_price = v.price,
              price_confidence  = v.confidence,
              price_updated_at  = now()
          from (values ${values}) as v(id, price, confidence)
          where c.id = v.id
        `),
      );
      await db
        .insert(marketState)
        .values(batch.map((u) => ({ cardId: u.id, currentPrice: u.price, updatedAt: now })))
        .onConflictDoUpdate({
          target: marketState.cardId,
          set: { currentPrice: excluded('current_price'), updatedAt: now },
        });
    }

    priced += updates.length;
    console.log(`  ${setId.padEnd(12)} ${String(updates.length).padStart(5)} priced`);
  }

  console.log(`\nPriced ${priced} cards. ${unpriced} had no source price and stay null.`);
  if (orphaned > 0) {
    console.warn(
      `${orphaned} priced cards are not in our catalogue (the price API is ahead of the ` +
        'bulk dataset). Re-run import-cards when the export catches up.',
    );
  }
}

runScript(main);
