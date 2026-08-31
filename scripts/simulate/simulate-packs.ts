/**
 * Pack simulation harness (DESIGN.md section 29).
 *
 * Runs N openings of a template against the real catalogue and reports the
 * observed distribution, so a probability bug shows up as a number rather than
 * as a player complaint months later.
 *
 *   npm run simulate -- --set=sv3pt5 --n=100000
 *   npm run simulate -- --set=base1
 *   npm run simulate -- --all --n=2000
 */
import { eq } from 'drizzle-orm';
import { getDb } from '../../packages/db/src/index.js';
import { sets, cards as cardsTable } from '../../packages/db/src/schema.js';
import { openPack, deriveTemplate, isReverseEligible, createSeed } from '../../packages/pack-engine/src/index.js';
import type { EngineCard } from '../../packages/pack-engine/src/types.js';
import { RARITY_TIERS, formatCents, cents, type RarityTier } from '../../packages/shared/src/index.js';
import { parseArgs, runScript } from '../import/http.js';

const pct = (n: number, d: number) => (d === 0 ? '0.00' : ((n / d) * 100).toFixed(2));

async function loadSet(setId: string) {
  const db = await getDb();
  const [set] = await db.select().from(sets).where(eq(sets.id, setId)).limit(1);
  if (!set) throw new Error(`No such set: ${setId}`);

  const rows = await db
    .select({
      id: cardsTable.id, number: cardsTable.number, rarityTier: cardsTable.rarityTier,
      price: cardsTable.marketBasePrice,
    })
    .from(cardsTable)
    .where(eq(cardsTable.setId, setId));

  const cards: EngineCard[] = rows.map((r) => ({
    id: r.id, setId, number: r.number,
    rarityTier: r.rarityTier as RarityTier,
    reverseEligible: isReverseEligible(set.era, r.rarityTier as RarityTier),
  }));

  const prices = new Map(rows.map((r) => [r.id, r.price]));
  return { set, cards, prices };
}

async function simulate(setId: string, n: number, verbose: boolean) {
  const { set, cards, prices } = await loadSet(setId);
  if (cards.length === 0) {
    console.log(`${setId}: no cards imported, skipping`);
    return;
  }

  const { template, tables } = deriveTemplate(set, cards);

  const rarityCount: Record<string, number> = Object.fromEntries(RARITY_TIERS.map((r) => [r, 0]));
  const hitSlotRarity: Record<string, number> = { ...rarityCount };
  const slotCount = new Map<string, number>();
  const uniqueSeen = new Set<string>();

  let hits = 0;
  let totalValue = 0;
  let pricedPulls = 0;
  let dupPrintings = 0;
  let totalCardsPulled = 0;

  const t0 = Date.now();

  for (let i = 0; i < n; i++) {
    const r = openPack({ template, tables, cards, seed: createSeed() });
    const printings = new Set<string>();
    let packHasHit = false;

    for (const c of r.cards) {
      totalCardsPulled++;
      rarityCount[c.rarityTier] = (rarityCount[c.rarityTier] ?? 0) + 1;
      slotCount.set(c.slotName, (slotCount.get(c.slotName) ?? 0) + 1);
      uniqueSeen.add(c.cardId);

      const key = `${c.cardId}:${c.isReverse}`;
      if (printings.has(key)) dupPrintings++;
      printings.add(key);

      if (c.slotName === 'hit') hitSlotRarity[c.rarityTier] = (hitSlotRarity[c.rarityTier] ?? 0) + 1;
      if (c.isHit) packHasHit = true;

      const p = prices.get(c.cardId);
      if (p != null) { totalValue += p; pricedPulls++; }
    }
    if (packHasHit) hits++;
  }

  const elapsed = (Date.now() - t0) / 1000;

  console.log(`\n${'═'.repeat(66)}`);
  console.log(`${set.name}  (${set.id})   era: ${set.era}`);
  console.log(`${'═'.repeat(66)}`);
  console.log(`  Template     ${template.id}  v${template.version}  ${template.cardsPerPack} cards/pack`);
  console.log(`  Confidence   ${template.confidence}`);
  console.log(`  Source       ${template.source}`);
  console.log(`  Set size     ${cards.length} cards`);
  console.log(`  Simulated    ${n.toLocaleString()} packs in ${elapsed.toFixed(1)}s (${Math.round(n / elapsed).toLocaleString()}/s)`);

  console.log(`\n  Rarity distribution across all pulls`);
  for (const tier of RARITY_TIERS) {
    const c = rarityCount[tier] ?? 0;
    if (c === 0) continue;
    console.log(`    ${tier.padEnd(13)} ${String(c).padStart(9)}  ${pct(c, totalCardsPulled).padStart(6)}%`);
  }

  console.log(`\n  Hit slot outcome (target vs observed)`);
  const hitTable = tables.find((t) => t.name === 'hit');
  const weights = hitTable?.rarityWeights ?? {};
  const weightTotal = Object.values(weights).reduce((a, b) => a + (b ?? 0), 0);
  for (const tier of RARITY_TIERS) {
    const c = hitSlotRarity[tier] ?? 0;
    const w = weights[tier as RarityTier];
    if (!w && c === 0) continue;
    const target = w ? ((w / weightTotal) * 100).toFixed(2) : '  -  ';
    const observed = pct(c, n);
    const dev = w ? (Number(observed) - Number(target)).toFixed(2) : '';
    console.log(`    ${tier.padEnd(13)} target ${String(target).padStart(6)}%   observed ${observed.padStart(6)}%   dev ${dev.padStart(6)}`);
  }

  console.log(`\n  Summary`);
  console.log(`    Packs with a hit (holo_rare+)   ${pct(hits, n)}%  (1 in ${(n / Math.max(hits, 1)).toFixed(1)})`);
  console.log(`    Distinct cards seen             ${uniqueSeen.size} / ${cards.length}  (${pct(uniqueSeen.size, cards.length)}% of set)`);
  console.log(`    Repeated printings in one pack  ${dupPrintings}  (must be 0)`);
  if (pricedPulls > 0) {
    const avg = totalValue / n;
    console.log(`    Priced pulls                    ${pct(pricedPulls, totalCardsPulled)}% of cards`);
    console.log(`    Average pack contents value     ${formatCents(cents(avg))}`);
  } else {
    console.log(`    Average pack value              n/a (no prices imported for this set)`);
  }

  if (dupPrintings > 0) {
    console.error(`\n  FAIL: ${dupPrintings} repeated printings — the distinct-group logic is broken.`);
    process.exitCode = 1;
  }
}

async function main() {
  const args = parseArgs();
  const n = Number(args.n ?? 100_000);
  const verbose = Boolean(args.verbose);

  if (args.all) {
    const db = await getDb();
    const all = await db.select({ id: sets.id }).from(sets).orderBy(sets.releaseDate);
    for (const s of all) await simulate(s.id, n, verbose);
    return;
  }

  const setId = typeof args.set === 'string' ? args.set : 'sv3pt5';
  await simulate(setId, n, verbose);
}

runScript(main);
