/**
 * Apply a reviewed sealed-booster market snapshot.
 *
 * The card API does not publish sealed-product values. These observations are
 * intentionally hand-curated from several markets and stored in source so a
 * price can be audited and refreshed without pretending a single listing is a
 * precise valuation. Values are USD cents; no exchange-rate conversions are
 * used. `market` observations are current market/price-guide values, while
 * `last_sold` is used only when a market has no active valuation.
 *
 * Run data:price-packs first so pack geometry and pull tables exist, then:
 *   npm run data:market-packs
 */
import { eq } from 'drizzle-orm';
import { cents, formatCents, type Cents } from '../../packages/shared/src/index';
import { getDb, assertNotLocked } from '../../packages/db/src/index';
import { packTemplates } from '../../packages/db/src/schema';
import { parseArgs, runScript } from './http';

type ObservationKind = 'market' | 'last_sold';

interface MarketObservation {
  market: 'tcgplayer' | 'pokevalues' | 'pricecharting';
  kind: ObservationKind;
  cents: Cents;
  url: string;
}

interface PackMarketSnapshot {
  setId: string;
  asOf: string;
  observations: readonly MarketObservation[];
}

// Reviewed 2026-09-01. Each pack has market data from TCGplayer (directly or
// via PokeValues), PriceCharting's completed-sales model, and PokeValues'
// multi-shop index. PriceCharting includes eBay completed sales and is the
// explicit last-sold fallback when a product has no current market listing.
export const MARKET_SNAPSHOTS: readonly PackMarketSnapshot[] = [
  {
    setId: 'me2pt5', asOf: '2026-09-01',
    observations: [
      { market: 'tcgplayer', kind: 'market', cents: cents(1382), url: 'https://www.tcgplayer.com/product/672434/pokemon-me-ascended-heroes-ascended-heroes-booster-pack' },
      { market: 'pokevalues', kind: 'market', cents: cents(1383), url: 'https://www.pokevalues.com/sealed/ascended-heroes-booster-pack' },
      { market: 'pricecharting', kind: 'last_sold', cents: cents(1410), url: 'https://www.pricecharting.com/game/pokemon-ascended-heroes/booster-pack' },
    ],
  },
  {
    setId: 'me3', asOf: '2026-09-01',
    observations: [
      { market: 'tcgplayer', kind: 'market', cents: cents(546), url: 'https://www.tcgplayer.com/product/672398/pokemon-me03-perfect-order-pokemon' },
      { market: 'pokevalues', kind: 'market', cents: cents(544), url: 'https://www.pokevalues.com/sealed/perfect-order-booster-pack' },
      { market: 'pricecharting', kind: 'last_sold', cents: cents(650), url: 'https://www.pricecharting.com/game/pokemon-perfect-order/booster-pack' },
    ],
  },
  {
    setId: 'me4', asOf: '2026-09-01',
    observations: [
      { market: 'tcgplayer', kind: 'market', cents: cents(523), url: 'https://www.tcgplayer.com/search/pokemon/product?q=Chaos+Rising+Booster+Pack&view=grid' },
      { market: 'pokevalues', kind: 'market', cents: cents(525), url: 'https://www.pokevalues.com/sealed/chaos-rising-booster-pack' },
      { market: 'pricecharting', kind: 'last_sold', cents: cents(675), url: 'https://www.pricecharting.com/game/pokemon-chaos-rising/booster-pack' },
    ],
  },
  {
    setId: 'me5', asOf: '2026-09-01',
    observations: [
      { market: 'tcgplayer', kind: 'market', cents: cents(568), url: 'https://www.tcgplayer.com/search/pokemon/product?Language=English&ProductTypeName=Sealed+Products&page=1&productLineName=pokemon&view=grid' },
      { market: 'pokevalues', kind: 'market', cents: cents(553), url: 'https://www.pokevalues.com/sealed/pitch-black-booster-pack' },
      { market: 'pricecharting', kind: 'last_sold', cents: cents(700), url: 'https://www.pricecharting.com/game/pokemon-pitch-black/booster-pack' },
    ],
  },
];

export function marketMedian(observations: readonly MarketObservation[]): Cents {
  const primary = observations.filter((o) => o.kind === 'market');
  const values = (primary.length > 0 ? primary : observations)
    .map((o) => o.cents)
    .sort((a, b) => a - b);
  if (values.length === 0) throw new Error('A market snapshot needs at least one observation.');
  const upper = Math.floor(values.length / 2);
  const lower = Math.floor((values.length - 1) / 2);
  // A two-market midpoint must be rounded in cents, never with a float.
  return cents(Math.floor((values[lower]! + values[upper]!) / 2));
}

export function sourceFor(snapshot: PackMarketSnapshot): string {
  const markets = [...new Set(snapshot.observations.map((o) => o.market))].join(',');
  return `market-median:${markets}@${snapshot.asOf}`;
}

function validate(snapshot: PackMarketSnapshot): void {
  if (snapshot.observations.length < 2) {
    throw new Error(`${snapshot.setId}: need at least two market observations.`);
  }
  for (const observation of snapshot.observations) {
    if (!Number.isInteger(observation.cents) || observation.cents <= 0) {
      throw new Error(`${snapshot.setId}: prices must be positive integer cents.`);
    }
    if (!observation.url.startsWith('https://')) {
      throw new Error(`${snapshot.setId}: source URL must be HTTPS.`);
    }
  }
}

async function main() {
  assertNotLocked();
  const args = parseArgs();
  const snapshots = typeof args.set === 'string'
    ? MARKET_SNAPSHOTS.filter((s) => s.setId === args.set)
    : MARKET_SNAPSHOTS;
  if (snapshots.length === 0) throw new Error(`No market snapshot for ${String(args.set)}.`);

  const db = await getDb();
  for (const snapshot of snapshots) {
    validate(snapshot);
    const id = `${snapshot.setId}-booster`;
    const template = (await db.select({ id: packTemplates.id }).from(packTemplates).where(eq(packTemplates.id, id)))[0];
    if (!template) {
      throw new Error(`${snapshot.setId}: no pack template. Run data:price-packs first.`);
    }
    const price = marketMedian(snapshot.observations);
    await db.update(packTemplates).set({
      simulatorPrice: price,
      confidence: 'estimated',
      source: sourceFor(snapshot),
    }).where(eq(packTemplates.id, id));
    console.log(`${snapshot.setId.padEnd(10)} ${formatCents(price).padStart(8)}  ${sourceFor(snapshot)}`);
  }
}

// Keep the observation data importable by unit tests without opening a database.
if (process.argv[1]?.endsWith('pack-market-prices.ts')) runScript(main);
