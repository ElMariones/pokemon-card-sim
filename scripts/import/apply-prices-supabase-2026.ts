/**
 * Sync the released 2026 sets to the linked Supabase project.
 *
 * `data:apply-prices` uses the application's DATABASE_URL, while this script
 * deliberately uses the authenticated Supabase CLI. That keeps a production
 * connection string out of source and works for the linked project only.
 *
 * First fetch fresh raw card prices, then run:
 *   npm run data:apply-prices-supabase-2026
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeRarity } from '../../packages/shared/src/index';
import { deriveTemplate, isReverseEligible, type EngineCard } from '../../packages/pack-engine/src/index';
import { selectBasePrice, type PriceSourceCard } from '../../packages/card-data/src/price-selection';
import { MARKET_SNAPSHOTS, marketMedian, sourceFor } from './pack-market-prices';
import { chunk, fetchJson, parseArgs, runScript } from './http';
import { atom, json, linkedQuery } from './supabase';

const CACHE_DIR = path.resolve('data/raw/prices');
const CARDS_URL = (setId: string) =>
  `https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/cards/en/${setId}.json`;
const SETS_URL = 'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/sets/en.json';

interface CachedCard extends PriceSourceCard { id: string }
interface SourceCard {
  id: string;
  number?: string;
  rarity?: string;
  supertype?: string;
  subtypes?: string[];
}
interface SourceSet { id: string; name: string; series: string }

async function main() {
  const args = parseArgs();
  const targets = typeof args.set === 'string'
    ? MARKET_SNAPSHOTS.filter((s) => s.setId === args.set)
    : MARKET_SNAPSHOTS;
  if (targets.length === 0) throw new Error(`No released 2026 market snapshot for ${String(args.set)}.`);

  const catalogue = await fetchJson<SourceSet[]>(SETS_URL);
  for (const snapshot of targets) {
    const set = catalogue.find((candidate) => candidate.id === snapshot.setId);
    if (!set) throw new Error(`${snapshot.setId}: not found in the live catalogue.`);
    const [sourceCards, cached] = await Promise.all([
      fetchJson<SourceCard[]>(CARDS_URL(snapshot.setId)),
      readFile(path.join(CACHE_DIR, `${snapshot.setId}.json`), 'utf8').then((file) => JSON.parse(file) as CachedCard[]),
    ]);
    const priceById = new Map(cached.map((card) => [card.id, selectBasePrice(card)]));
    const prices = sourceCards.flatMap((card) => {
      const price = priceById.get(card.id);
      return price?.price === null || price === undefined ? [] : [{ id: card.id, price: price.price, confidence: price.confidence }];
    });
    for (const batch of chunk(prices, 150)) {
      const values = batch.map((row) => `(${atom(row.id)},${atom(row.price)},${atom(row.confidence)})`).join(',');
      await linkedQuery(`update public.cards as c set market_base_price = v.price, price_confidence = v.confidence, price_updated_at = now() from (values ${values}) as v(id, price, confidence) where c.id = v.id;`);
      await linkedQuery(`insert into public.market_state (card_id, current_price, updated_at) values ${batch.map((row) => `(${atom(row.id)},${atom(row.price)},now())`).join(',')} on conflict (card_id) do update set current_price = excluded.current_price, updated_at = excluded.updated_at;`);
    }

    const engineCards: EngineCard[] = sourceCards.map((card) => {
      const rarityTier = normalizeRarity({ rarity: card.rarity, supertype: card.supertype, subtypes: card.subtypes });
      return {
        id: card.id,
        setId: snapshot.setId,
        number: card.number ?? card.id,
        rarityTier,
        reverseEligible: isReverseEligible('me', rarityTier),
      };
    });
    const { template, tables } = deriveTemplate({ id: set.id, name: set.name, era: 'me' }, engineCards);
    const price = marketMedian(snapshot.observations);
    await linkedQuery(`insert into public.pack_templates (id, set_id, name, product_type, cards_per_pack, slots, simulator_price, confidence, source, version) values (${atom(template.id)},${atom(template.setId)},${atom(template.name)},${atom(template.productType)},${atom(template.cardsPerPack)},${json(template.slots)},${atom(price)},'estimated',${atom(sourceFor(snapshot))},${atom(template.version)}) on conflict (id) do update set cards_per_pack = excluded.cards_per_pack, slots = excluded.slots, simulator_price = excluded.simulator_price, confidence = excluded.confidence, source = excluded.source, version = excluded.version;`);
    for (const table of tables) {
      await linkedQuery(`insert into public.pull_tables (id, set_id, name, selection_mode, entries, rarity_weights, confidence, source, version) values (${atom(table.id)},${atom(snapshot.setId)},${atom(table.name)},${atom(table.selectionMode)},${json(table.entries)},${json(table.rarityWeights ?? null)},${atom(table.confidence)},${atom(table.source)},${atom(table.version)}) on conflict (id) do update set entries = excluded.entries, rarity_weights = excluded.rarity_weights, confidence = excluded.confidence, source = excluded.source, version = excluded.version;`);
    }
    console.log(`${snapshot.setId}: ${prices.length}/${sourceCards.length} card prices, pack ${price} cents.`);
  }
}

runScript(main);
