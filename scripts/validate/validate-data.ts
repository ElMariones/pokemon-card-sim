/**
 * Data-quality dashboard (DESIGN.md section 34).
 *
 * Prints a report on catalogue completeness and exits non-zero when a hard
 * integrity check fails, so it can gate a deploy.
 */
import { sql } from 'drizzle-orm';
import { getDb, assertNotLocked } from '../../packages/db/src/index';
import { runScript } from '../import/http';

async function main() {
  assertNotLocked();
  const db = await getDb();
  const q = async <T = Record<string, unknown>>(text: string): Promise<T[]> =>
    (await db.execute(sql.raw(text))).rows as T[];
  const one = async (text: string): Promise<number> =>
    Number((await q<{ n: number }>(text))[0]?.n ?? 0);

  const setCount = await one('select count(*)::int n from sets');
  const cardCount = await one('select count(*)::int n from cards');
  const priced = await one('select count(*)::int n from cards where market_base_price is not null');
  const noImage = await one('select count(*)::int n from cards where image_small is null');
  const unknownTier = await one("select count(*)::int n from cards where rarity_tier = 'unknown'");
  const emptySets = await q<{ id: string; name: string }>(
    'select s.id, s.name from sets s left join cards c on c.set_id = s.id where c.id is null order by s.release_date',
  );

  console.log('═══ Catalogue ═══');
  console.log(`  Sets:            ${setCount}`);
  console.log(`  Cards:           ${cardCount}`);
  console.log(`  Sets with cards: ${setCount - emptySets.length}`);

  console.log('\n═══ Rarity distribution ═══');
  for (const r of await q<{ rarity_tier: string; n: number }>(
    'select rarity_tier, count(*)::int n from cards group by 1 order by n desc',
  )) {
    const pct = ((Number(r.n) / cardCount) * 100).toFixed(1);
    console.log(`  ${r.rarity_tier.padEnd(14)} ${String(r.n).padStart(6)}  ${pct.padStart(5)}%`);
  }

  console.log('\n═══ Coverage by era ═══');
  for (const e of await q<{ era: string; sets: number; cards: number; priced: number }>(`
    select s.era,
           count(distinct s.id)::int sets,
           count(c.id)::int cards,
           count(c.market_base_price)::int priced
    from sets s left join cards c on c.set_id = s.id
    group by 1 order by cards desc`)) {
    console.log(
      `  ${e.era.padEnd(10)} ${String(e.sets).padStart(4)} sets  ${String(e.cards).padStart(6)} cards  ${String(e.priced).padStart(6)} priced`,
    );
  }

  console.log('\n═══ Gaps ═══');
  const pricedPct = cardCount ? ((priced / cardCount) * 100).toFixed(1) : '0';
  console.log(`  Priced cards:    ${priced} (${pricedPct}%)`);
  console.log(`  Missing price:   ${cardCount - priced}`);
  console.log(`  Missing image:   ${noImage}`);
  console.log(`  Unknown rarity:  ${unknownTier}`);

  if (unknownTier > 0) {
    console.log('\n  Unknown-tier cards by source rarity string:');
    for (const r of await q<{ raw: string; n: number }>(`
      select coalesce(rarity_raw, '(no rarity on card)') raw, count(*)::int n
      from cards where rarity_tier = 'unknown' group by 1 order by n desc limit 15`)) {
      console.log(`    ${String(r.n).padStart(6)}x  ${r.raw}`);
    }
  }

  if (emptySets.length > 0) {
    console.log(`\n  ${emptySets.length} sets have no cards imported:`);
    for (const s of emptySets.slice(0, 10)) console.log(`    ${s.id.padEnd(12)} ${s.name}`);
    if (emptySets.length > 10) console.log(`    ... and ${emptySets.length - 10} more`);
  }

  // ── Hard integrity checks ────────────────────────────────────────────────
  console.log('\n═══ Integrity ═══');
  const failures: string[] = [];

  const orphans = await one(
    'select count(*)::int n from cards c left join sets s on s.id = c.set_id where s.id is null',
  );
  const dupes = await one(
    'select count(*)::int n from (select set_id, number from cards group by 1,2 having count(*) > 1) d',
  );
  const negPrice = await one('select count(*)::int n from cards where market_base_price < 0');
  const badDate = await one("select count(*)::int n from sets where release_date !~ '^\\d{4}-\\d{2}-\\d{2}$'");

  const check = (label: string, bad: number) => {
    console.log(`  ${bad === 0 ? 'PASS' : 'FAIL'}  ${label}${bad ? `: ${bad}` : ''}`);
    if (bad > 0) failures.push(label);
  };

  check('No orphan cards', orphans);
  check('No duplicate (set, number)', dupes);
  check('No negative prices', negPrice);
  check('All release dates are YYYY-MM-DD', badDate);

  if (failures.length > 0) {
    console.error(`\n${failures.length} integrity check(s) failed.`);
    process.exitCode = 1;
    throw new Error('Data validation failed');
  }
  console.log('\nAll integrity checks passed.');
}

runScript(main);
