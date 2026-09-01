/**
 * Compute and store a simulated price for every set's pack.
 *
 * Why simulate rather than compute analytically: the closed-form expected
 * value cannot account for the no-duplicate-printing rule, which biases each
 * draw toward cards not already in the pack. In small sets that bias is large
 * enough to push realised value above the analytic estimate — one set came out
 * profitable to spam-open, which DESIGN.md section 30 forbids.
 *
 * Simulating the actual engine removes the approximation entirely. The result
 * is cached in pack_templates.simulatorPrice so the shop reads a number rather
 * than running 20,000 openings per request. A verified sealed-market snapshot
 * can replace that fallback via data:market-packs; those values deliberately
 * survive subsequent simulations.
 *
 *   npx tsx scripts/simulate/price-packs.ts --n=20000
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

async function main() {
  assertNotLocked();
  const args = parseArgs();
  const n = Number(args.n ?? 20_000);
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

  let worst = 0;
  let worstSet = '';

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
    const price = derivePackPrice(measured);
    const existing = (await db
      .select({ simulatorPrice: packTemplates.simulatorPrice, source: packTemplates.source })
      .from(packTemplates)
      .where(eq(packTemplates.id, template.id)))[0];
    const marketTemplate = existing?.source.startsWith('market-median:') ? existing : null;
    const hasMarketPrice = marketTemplate !== null;
    const effectivePrice: Cents = marketTemplate ? cents(marketTemplate.simulatorPrice) : price;
    const effectiveSource = marketTemplate ? marketTemplate.source : template.source;
    const ret = effectivePrice === 0 ? 0 : measured / effectivePrice;
    if (ret > worst) { worst = ret; worstSet = set.id; }

    await db
      .insert(packTemplates)
      .values({
        id: template.id, setId: set.id, name: template.name,
        productType: template.productType, cardsPerPack: template.cardsPerPack,
        slots: template.slots, simulatorPrice: effectivePrice,
        confidence: hasMarketPrice ? 'estimated' : template.confidence,
        source: effectiveSource, version: template.version,
      })
      .onConflictDoUpdate({
        target: packTemplates.id,
        set: {
          simulatorPrice: effectivePrice, slots: template.slots,
          cardsPerPack: template.cardsPerPack,
          confidence: hasMarketPrice ? 'estimated' : template.confidence,
          source: effectiveSource, version: template.version,
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
        `  contents ${formatCents(measured).padStart(9)}  return ${(ret * 100).toFixed(1)}%`,
    );
  }

  console.log(`\nWorst return: ${(worst * 100).toFixed(1)}% (${worstSet})`);
  if (worst >= 1) {
    console.error('FAIL: a set returns at least what it costs.');
    process.exitCode = 1;
  } else {
    console.log('No set is profitable to spam-open.');
  }
}

runScript(main);
