/**
 * Give every pack a real price.
 *
 * A pack used to be priced from its own contents (expected value plus a house
 * edge), which made the return identical for every set and made a 1999 Base
 * Set pack cost more than the $846 one actually trades for. Sealed product has
 * its own market: the pack is the collectible, not just a bag of cards.
 *
 * Order of evidence, best first (see resolvePackPrice):
 *   1. a hand-reviewed multi-market snapshot
 *   2. today's TCGplayer quote for the set's booster pack
 *   3. the median real pack price of the set's era — for sets that were never
 *      sold as boosters at all (promos, McDonald's, POP, trainer kits)
 *   4. the contents derivation, left in place as simulator_price
 *
 * Run after data:price-packs, which is what creates the templates.
 *
 *   npx tsx scripts/import/apply-pack-prices.ts
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb, assertNotLocked } from '../../packages/db/src/index';
import { packTemplates, sets } from '../../packages/db/src/schema';
import { selectBoosterPack, type TcgcsvPrice } from '../../packages/card-data/src/tcgcsv';
import { resolveCardGroup, type TcgplayerGroup } from '../../packages/card-data/src/tcgplayer-groups';
import { medianCents, resolvePackPrice, type PackPriceSource } from '../../packages/economy-engine/src/pricing';
import { cents, dollarsToCents, formatCents, type Cents } from '../../packages/shared/src/index';
import { MARKET_SNAPSHOTS, marketMedian, validateSnapshot } from './pack-market-prices';
import type { GroupCache } from './fetch-tcgcsv';
import { parseArgs, runScript } from './http';

const TCGCSV_CACHE = path.resolve('data/raw/tcgcsv');

const readJson = async <T>(file: string): Promise<T | null> => {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch { return null; }
};

interface Observed {
  setId: string;
  era: string;
  ptcgoCode: string | null;
  templateId: string;
  simulatorPrice: Cents;
  curated: Cents | null;
  market: Cents | null;
  productId: number | null;
}

/** The quoted booster pack in one group, if it has one. */
async function packPriceIn(groupId: number): Promise<{ price: Cents; productId: number } | null> {
  const cache = await readJson<GroupCache>(path.join(TCGCSV_CACHE, `${groupId}.json`));
  if (!cache) return null;
  const byProduct = new Map<number, TcgcsvPrice>();
  for (const row of cache.prices) {
    if (row.subTypeName === 'Normal' || !byProduct.has(row.productId)) byProduct.set(row.productId, row);
  }
  const pack = selectBoosterPack(cache.products, byProduct);
  if (pack?.marketPrice == null) return null;
  return { price: dollarsToCents(pack.marketPrice), productId: pack.product.productId };
}

async function main() {
  assertNotLocked();
  const args = parseArgs();
  const db = await getDb();

  const groups = (await readJson<TcgplayerGroup[]>(path.join(TCGCSV_CACHE, 'groups.json'))) ?? [];
  if (groups.length === 0) throw new Error('No tcgcsv cache. Run fetch-tcgcsv first.');

  const curated = new Map<string, Cents>();
  for (const snapshot of MARKET_SNAPSHOTS) {
    validateSnapshot(snapshot);
    curated.set(snapshot.setId, marketMedian(snapshot.observations));
  }

  const templates = await db
    .select({
      templateId: packTemplates.id,
      simulatorPrice: packTemplates.simulatorPrice,
      setId: sets.id,
      name: sets.name,
      era: sets.era,
      ptcgoCode: sets.ptcgoCode,
    })
    .from(packTemplates)
    .innerJoin(sets, eq(sets.id, packTemplates.setId))
    .orderBy(sets.releaseDate);

  console.log(`Pricing ${templates.length} pack templates from sealed-market data\n`);

  // Pass one: what the market quotes for each set's own booster pack.
  const observed: Observed[] = [];
  for (const t of templates) {
    const group = resolveCardGroup({ id: t.setId, name: t.name, ptcgoCode: t.ptcgoCode }, groups);
    const found = group ? await packPriceIn(group.groupId) : null;

    observed.push({
      setId: t.setId, era: t.era, ptcgoCode: t.ptcgoCode, templateId: t.templateId,
      simulatorPrice: cents(t.simulatorPrice),
      curated: curated.get(t.setId) ?? null,
      market: found?.price ?? null,
      productId: found?.productId ?? null,
    });
  }

  // Pass two: an era median, built only from prices the market really quoted.
  const byEra = new Map<string, Cents[]>();
  for (const o of observed) {
    const real = o.curated ?? o.market;
    if (real === null) continue;
    const list = byEra.get(o.era);
    if (list) list.push(real); else byEra.set(o.era, [real]);
  }
  const eraMedian = new Map<string, Cents>();
  for (const [era, values] of byEra) {
    const median = medianCents(values);
    if (median !== null) eraMedian.set(era, median);
  }

  console.log('Era medians from real pack prices:');
  for (const [era, median] of [...eraMedian].sort()) {
    console.log(`  ${era.padEnd(10)} ${formatCents(median).padStart(10)}  (${byEra.get(era)!.length} sets)`);
  }

  // A subset shares its parent's PTCGO code and has no booster of its own: a
  // Trainer Gallery card comes out of the parent set's pack. So the sibling
  // that does have a quoted pack is where its price comes from.
  const parentPrice = new Map<string, { price: Cents; setId: string }>();
  for (const o of observed) {
    const real = o.curated ?? o.market;
    if (real === null || !o.ptcgoCode) continue;
    if (!parentPrice.has(o.ptcgoCode)) parentPrice.set(o.ptcgoCode, { price: real, setId: o.setId });
  }

  const counts: Record<PackPriceSource, number> = {
    curated: 0, market: 0, inherited: 0, era_median: 0, simulated: 0,
  };
  const now = new Date();
  let unresolved = 0;

  for (const o of observed) {
    const parent = o.ptcgoCode ? parentPrice.get(o.ptcgoCode) : undefined;
    const inherited = parent && parent.setId !== o.setId ? parent.price : null;
    const resolution = resolvePackPrice({
      curated: o.curated,
      market: o.market,
      inherited,
      eraMedian: eraMedian.get(o.era) ?? null,
      simulatedEv: o.simulatorPrice,
    });
    if (!resolution) { unresolved++; continue; }
    counts[resolution.source]++;

    // The contents derivation is not a market observation, so it stays in
    // simulator_price where it came from and market_base_price stays null.
    if (resolution.source === 'simulated') continue;

    const source =
      resolution.source === 'curated' ? `curated:${o.setId}`
      : resolution.source === 'market' ? `tcgplayer:${o.productId}`
      : resolution.source === 'inherited' ? `inherited:${parent!.setId}`
      : `era_median:${o.era}`;

    await db
      .update(packTemplates)
      .set({
        marketBasePrice: resolution.price,
        priceConfidence: resolution.confidence,
        priceSource: source,
        priceUpdatedAt: now,
      })
      .where(eq(packTemplates.id, o.templateId));
  }

  console.log('\nPrice source:');
  console.log(`  curated snapshot   ${counts.curated}`);
  console.log(`  tcgplayer market   ${counts.market}`);
  console.log(`  parent set's pack  ${counts.inherited}`);
  console.log(`  era median         ${counts.era_median}`);
  console.log(`  contents fallback  ${counts.simulated}`);
  if (unresolved > 0) console.warn(`  no price at all     ${unresolved}`);

  if (args.verbose) {
    console.log('\nBiggest moves against the old contents-derived price:');
    const moves = observed
      .filter((o) => (o.curated ?? o.market) !== null)
      .map((o) => ({ id: o.setId, from: o.simulatorPrice, to: (o.curated ?? o.market)! }))
      .sort((a, b) => b.to / b.from - a.to / a.from)
      .slice(0, 15);
    for (const m of moves) {
      console.log(`  ${m.id.padEnd(12)} ${formatCents(cents(m.from)).padStart(10)} -> ${formatCents(cents(m.to)).padStart(10)}  (x${(m.to / m.from).toFixed(1)})`);
    }
  }
}

runScript(main);
