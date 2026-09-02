/**
 * Apply cached price data to the database. Touches the database, never the
 * network. Fast, so it can run between dev-server sessions.
 *
 * Two feeds, one policy. tcgcsv is TCGplayer's own daily export and is tried
 * first: it covers sets api.pokemontcg.io ships without any price block, and
 * it quotes more printings per card. The API cache is the fallback. Both are
 * adapted into the same shape and go through `selectBasePrice`, so "market
 * price" means one thing in the cards table no matter which feed supplied it.
 *
 * Matching to tcgcsv is by collector number within the set's TCGplayer group.
 * A set whose numbering does not line up is reported and left to the API
 * rather than priced from whatever happened to match.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql, eq } from 'drizzle-orm';
import { getDb, assertNotLocked } from '../../packages/db/src/index';
import { cards, marketState, sets } from '../../packages/db/src/schema';
import { selectBasePrice, type PriceSelection, type PriceSourceCard } from '../../packages/card-data/src/price-selection';
import { toPriceSourceCard, type TcgcsvPrice } from '../../packages/card-data/src/tcgcsv';
import { resolveCardGroup, type TcgplayerGroup } from '../../packages/card-data/src/tcgplayer-groups';
import type { GroupCache } from './fetch-tcgcsv';
import { chunk, parseArgs, runScript } from './http';

const API_CACHE = path.resolve('data/raw/prices');
const TCGCSV_CACHE = path.resolve('data/raw/tcgcsv');
const excluded = (c: string) => sql.raw(`excluded.${c}`);

/**
 * Below this share of a set's cards matching a tcgcsv product, the numbering
 * does not line up and the matches that did happen are not to be trusted.
 */
const MIN_MATCH_RATE = 0.9;

interface CachedApiCard extends PriceSourceCard { id: string }

const readJson = async <T>(file: string): Promise<T | null> => {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch { return null; }
};

/** Collector number as both feeds would write it, so they can be compared. */
const numberKey = (n: string): string =>
  /^\d+$/.test(n.trim()) ? String(Number(n)) : n.trim().toUpperCase();

async function main() {
  assertNotLocked();
  const args = parseArgs();
  const force = Boolean(args.force);
  const db = await getDb();

  const groups = (await readJson<TcgplayerGroup[]>(path.join(TCGCSV_CACHE, 'groups.json'))) ?? [];
  if (groups.length === 0) {
    console.warn('No tcgcsv cache found. Run fetch-tcgcsv first; falling back to the API cache.\n');
  }

  let setRows = await db
    .select({ id: sets.id, name: sets.name, ptcgoCode: sets.ptcgoCode })
    .from(sets)
    .orderBy(sets.releaseDate);
  if (typeof args.set === 'string') setRows = setRows.filter((s) => s.id === args.set);

  const now = new Date();
  let priced = 0;
  let unpriced = 0;
  let orphaned = 0;
  let fromTcgcsv = 0;
  const lowMatch: string[] = [];
  const unmatchedSets: string[] = [];

  for (const set of setRows) {
    const catalogue = await db
      .select({ id: cards.id, number: cards.number })
      .from(cards)
      .where(eq(cards.setId, set.id));
    if (catalogue.length === 0) continue;

    // --- tcgcsv, by collector number within the set's group -----------------
    const group = resolveCardGroup(set, groups);
    const cache = group ? await readJson<GroupCache>(path.join(TCGCSV_CACHE, `${group.groupId}.json`)) : null;
    let byNumber = new Map<string, PriceSourceCard>();

    if (cache) {
      const rowsByProduct = new Map<number, TcgcsvPrice[]>();
      for (const row of cache.prices) {
        const list = rowsByProduct.get(row.productId);
        if (list) list.push(row); else rowsByProduct.set(row.productId, [row]);
      }
      for (const product of cache.products) {
        if (!product.number) continue;
        const rows = rowsByProduct.get(product.productId);
        if (!rows?.length) continue;
        byNumber.set(numberKey(product.number), toPriceSourceCard(rows, product.url));
      }

      const matched = catalogue.filter((c) => byNumber.has(numberKey(c.number))).length;
      const rate = matched / catalogue.length;
      if (rate < MIN_MATCH_RATE && !force) {
        lowMatch.push(`${set.id} ${(rate * 100).toFixed(0)}% (${matched}/${catalogue.length}) -> ${cache.name}`);
        byNumber = new Map();
      }
    } else if (!group) {
      unmatchedSets.push(set.id);
    }

    // --- the API cache, by card id -----------------------------------------
    const api = (await readJson<CachedApiCard[]>(path.join(API_CACHE, `${set.id}.json`))) ?? [];
    const byId = new Map(api.map((c) => [c.id, c]));
    const known = new Set(catalogue.map((c) => c.id));
    orphaned += api.filter((c) => !known.has(c.id)).length;

    const updates: { id: string; price: number; confidence: string; source: string }[] = [];
    for (const card of catalogue) {
      let selection: PriceSelection | null = null;
      let source = '';

      const fromMirror = byNumber.get(numberKey(card.number));
      if (fromMirror) {
        const sel = selectBasePrice(fromMirror);
        if (sel.price !== null) { selection = sel; source = 'tcgcsv'; }
      }
      if (!selection) {
        const sel = selectBasePrice(byId.get(card.id));
        if (sel.price !== null) { selection = sel; source = 'pokemontcg.io'; }
      }
      if (!selection) { unpriced++; continue; }

      if (source === 'tcgcsv') fromTcgcsv++;
      updates.push({ id: card.id, price: selection.price!, confidence: selection.confidence, source });
    }

    // One statement per chunk rather than one per card: a per-card UPDATE over
    // 20k cards is thousands of round trips and takes minutes.
    for (const batch of chunk(updates, 500)) {
      if (batch.length === 0) continue;
      const values = batch
        .map((u) => `('${u.id.replace(/'/g, "''")}', ${u.price}, '${u.confidence}', '${u.source}')`)
        .join(',');
      await db.execute(
        sql.raw(`
          update cards as c
          set market_base_price = v.price,
              price_confidence  = v.confidence,
              price_source      = v.source,
              price_updated_at  = now()
          from (values ${values}) as v(id, price, confidence, source)
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
    console.log(`  ${set.id.padEnd(12)} ${String(updates.length).padStart(5)} priced${cache ? '' : '   (API only)'}`);
  }

  console.log(`\nPriced ${priced} cards — ${fromTcgcsv} from tcgcsv, ${priced - fromTcgcsv} from the API cache.`);
  console.log(`${unpriced} cards have no source price and stay null.`);

  if (lowMatch.length > 0) {
    console.warn(`\n${lowMatch.length} sets fell below the ${MIN_MATCH_RATE * 100}% number-match rate and used the API only:`);
    for (const line of lowMatch) console.warn(`  ${line}`);
    console.warn('Pass --force to price them from tcgcsv anyway.');
  }
  if (unmatchedSets.length > 0) {
    console.warn(`\n${unmatchedSets.length} sets have no TCGplayer group: ${unmatchedSets.join(' ')}`);
  }
  if (orphaned > 0) {
    console.warn(
      `\n${orphaned} priced cards are not in our catalogue (the price API is ahead of the ` +
        'bulk dataset). Re-run import-cards when the export catches up.',
    );
  }
}

runScript(main);
