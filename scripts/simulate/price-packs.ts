/**
 * Measure what a pack contains, and report it against what a pack costs.
 *
 * Why simulate rather than compute analytically: the closed-form expected
 * value cannot account for the no-duplicate-printing rule, which biases each
 * draw toward cards not already in the pack. Simulating the actual engine
 * removes the approximation entirely.
 *
 * This script no longer decides prices. A pack costs what sealed product
 * trades for (see apply-pack-prices.ts); the measured value is written to
 * pack_templates.simulatorPrice, which serves two purposes: it is the price
 * for sets no market covers, and it is the diagnostic that says whether the
 * pull model produces a plausible pack.
 *
 * A set whose contents beat its market price is listed at the end. Those are
 * real — vintage packs are priced as collectibles, hyped modern sets are not —
 * but a NEW one usually means the pull model over-values that set, so
 * --strict fails on any set outside the known list.
 *
 *   npx tsx scripts/simulate/price-packs.ts --n=20000
 *   npx tsx scripts/simulate/price-packs.ts --strict
 */
import { eq, sql } from 'drizzle-orm';
import { getDb, assertNotLocked } from '../../packages/db/src/index';
import { sets, cards as cardsTable, packTemplates, pullTables } from '../../packages/db/src/schema';
import {
  openPack, deriveTemplate, isReverseEligible, createSeed,
} from '../../packages/pack-engine/src/index';
import type { EngineCard } from '../../packages/pack-engine/src/types';
import { formatCents, cents, type Cents, type RarityTier } from '../../packages/shared/src/index';
import { derivePackPrice } from '../../packages/economy-engine/src/pricing';
import { parseArgs, runScript } from '../import/http';

/**
 * Sets whose contents beat their sealed price, reviewed and accepted.
 *
 * Vintage sealed is priced as a collectible, so those never appear here; these
 * are modern sets whose singles carry more value than the pack costs, which is
 * also true of the real product. They are the reason to know the market.
 */
const KNOWN_PROFITABLE = new Set([
  'zsv10pt5',  // Black Bolt
  'rsv10pt5',  // White Flare
  'sv6pt5',    // Shrouded Fable
  'sv8pt5',    // Prismatic Evolutions
  'swsh6',     // Chilling Reign
  'pgo',       // Pokemon GO
  'det1',      // Detective Pikachu
  'cel25',     // Celebrations
  'sv2',       // Paldea Evolved
  'me4',       // Chaos Rising — sits within a point of break-even
  'me5',       // Pitch Black
  'me2pt5',    // Ascended Heroes
]);

async function main() {
  assertNotLocked();
  const args = parseArgs();
  const n = Number(args.n ?? 20_000);
  const strict = Boolean(args.strict);
  const profitable: {
    setId: string; ret: number; price: Cents; measured: Cents; borrowedPack: boolean;
  }[] = [];
  const db = await getDb();

  // Only sets we hold prices for can be priced meaningfully.
  const targets = await db
    .select({ id: sets.id, name: sets.name, era: sets.era, priced: sql<number>`count(*)::int` })
    .from(sets)
    .innerJoin(cardsTable, eq(cardsTable.setId, sets.id))
    .where(sql`${cardsTable.marketBasePrice} is not null`)
    .groupBy(sets.id)
    .orderBy(sets.releaseDate);

  console.log(`Simulating ${n.toLocaleString()} packs for each of ${targets.length} priced sets\n`);

  let bestReturn = 0;
  let bestSet = '';

  for (const set of targets) {
    const rows = await db
      .select({
        id: cardsTable.id, number: cardsTable.number,
        rarityTier: cardsTable.rarityTier, price: cardsTable.marketBasePrice,
      })
      .from(cardsTable)
      .where(eq(cardsTable.setId, set.id));

    const engineCards: EngineCard[] = rows.map((r) => ({
      id: r.id, setId: set.id, number: r.number,
      rarityTier: r.rarityTier as RarityTier,
      reverseEligible: isReverseEligible(set.era, r.rarityTier as RarityTier),
    }));
    const prices = new Map(rows.map((r) => [r.id, r.price ?? 0]));
    const { template, tables } = deriveTemplate(set, engineCards);

    let total = 0;
    try {
      for (let i = 0; i < n; i++) {
        const r = openPack({ template, tables, cards: engineCards, seed: createSeed() });
        for (const c of r.cards) total += prices.get(c.cardId) ?? 0;
      }
    } catch (err) {
      console.error(`  ${set.id.padEnd(12)} SKIPPED: ${(err as Error).message}`);
      continue;
    }

    const measured = cents(Math.round(total / n));
    const derived = derivePackPrice(measured);
    const existing = (await db
      .select({
        marketBasePrice: packTemplates.marketBasePrice,
        priceSource: packTemplates.priceSource,
      })
      .from(packTemplates)
      .where(eq(packTemplates.id, template.id)))[0];

    // What the player actually pays: the sealed market when we have it.
    const marketPrice = existing?.marketBasePrice ?? null;
    const effectivePrice: Cents = marketPrice && marketPrice > 0 ? cents(marketPrice) : derived;
    const ret = effectivePrice === 0 ? 0 : measured / effectivePrice;
    if (ret > bestReturn) { bestReturn = ret; bestSet = set.id; }
    if (ret >= 1) {
      profitable.push({
        setId: set.id, ret, price: effectivePrice, measured,
        // A subset has no booster of its own, so it is priced from its parent's
        // pack — and then "opening" it yields nothing but chase cards.
        borrowedPack: existing?.priceSource?.startsWith('inherited:') ?? false,
      });
    }

    await db
      .insert(packTemplates)
      .values({
        id: template.id, setId: set.id, name: template.name,
        productType: template.productType, cardsPerPack: template.cardsPerPack,
        slots: template.slots, simulatorPrice: derived,
        confidence: template.confidence,
        source: template.source, version: template.version,
      })
      .onConflictDoUpdate({
        target: packTemplates.id,
        // market_base_price is deliberately absent: it is owned by
        // apply-pack-prices and must survive a re-simulation.
        set: {
          simulatorPrice: derived, slots: template.slots,
          cardsPerPack: template.cardsPerPack,
          confidence: template.confidence,
          source: template.source, version: template.version,
        },
      });

    for (const t of tables) {
      await db
        .insert(pullTables)
        .values({
          id: t.id, setId: set.id, name: t.name, selectionMode: t.selectionMode,
          entries: t.entries, rarityWeights: t.rarityWeights ?? null,
          confidence: t.confidence, source: t.source, version: t.version,
        })
        .onConflictDoUpdate({
          target: pullTables.id,
          set: {
            entries: t.entries, rarityWeights: t.rarityWeights ?? null,
            confidence: t.confidence, source: t.source, version: t.version,
          },
        });
    }

    console.log(
      `  ${set.id.padEnd(12)} price ${formatCents(effectivePrice).padStart(9)}` +
        `${marketPrice ? ' mkt' : ' sim'}  contents ${formatCents(measured).padStart(9)}` +
        `  return ${(ret * 100).toFixed(1)}%`,
    );
  }

  console.log(`\nBest return: ${(bestReturn * 100).toFixed(1)}% (${bestSet})`);

  if (profitable.length === 0) {
    console.log('No set returns what it costs.');
    return;
  }

  const label = (p: { setId: string; borrowedPack: boolean }) =>
    p.borrowedPack ? '  <- subset, no pack of its own'
    : KNOWN_PROFITABLE.has(p.setId) ? ''
    : '  <- NEW';

  console.log(`\n${profitable.length} sets return at least their price:`);
  for (const p of profitable.sort((a, b) => b.ret - a.ret)) {
    console.log(
      `  ${p.setId.padEnd(12)} ${formatCents(p.price).padStart(9)} -> ` +
        `${formatCents(p.measured).padStart(9)}  ${(p.ret * 100).toFixed(0)}%${label(p)}`,
    );
  }

  const subsets = profitable.filter((p) => p.borrowedPack);
  if (subsets.length > 0) {
    console.warn(
      `\n${subsets.length} of those are subsets — Trainer Galleries, Shiny Vaults — that\n` +
        'were never sold as their own pack. We charge the parent set\'s pack price and\n' +
        'then deal a pack made entirely of chase cards, which is why they read as\n' +
        `${Math.round(Math.max(...subsets.map((p) => p.ret)) * 100)}%. The fix is in the pack engine, not in pricing:\n` +
        'their cards belong in the parent set\'s pull tables.',
    );
  }

  const unexpected = profitable.filter((p) => !p.borrowedPack && !KNOWN_PROFITABLE.has(p.setId));
  if (unexpected.length === 0) {
    console.log('\nEvery other profitable set is reviewed and accepted (see KNOWN_PROFITABLE).');
    return;
  }

  console.error(
    `\n${unexpected.length} newly profitable sets: ${unexpected.map((p) => p.setId).join(' ')}\n` +
      'The engine picks uniformly within a rarity tier, so a set full of chase\n' +
      'cards over-values. Check the pull model before accepting these.',
  );
  if (strict) process.exitCode = 1;
}

runScript(main);
