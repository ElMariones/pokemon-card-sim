/**
 * Import the set catalogue.
 *
 * Source: PokemonTCG/pokemon-tcg-data bulk JSON (no rate limit, no API key).
 * Idempotent: re-running updates in place rather than duplicating.
 */
import { getDb } from '../../packages/db/src/index.js';
import { sets } from '../../packages/db/src/schema.js';
import { deriveEra, isKnownSeries } from '../../packages/card-data/src/era.js';
import { fetchJson, normalizeDate, chunk, runScript } from './http.js';

const SETS_URL = 'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/sets/en.json';
const SOURCE = 'pokemon-tcg-data';

interface SourceSet {
  id: string;
  name: string;
  series: string;
  printedTotal?: number;
  total?: number;
  releaseDate?: string;
  images?: { symbol?: string; logo?: string };
}

async function main() {
  console.log('Fetching set catalogue...');
  const source = await fetchJson<SourceSet[]>(SETS_URL);
  console.log(`  ${source.length} sets`);

  const unknownSeries = new Set<string>();
  const rows = source.map((s) => {
    if (!isKnownSeries(s.series)) unknownSeries.add(s.series);
    return {
      id: s.id,
      name: s.name,
      series: s.series ?? 'Other',
      era: deriveEra(s.series),
      releaseDate: normalizeDate(s.releaseDate),
      printedTotal: s.printedTotal ?? 0,
      total: s.total ?? 0,
      logoUrl: s.images?.logo ?? null,
      symbolUrl: s.images?.symbol ?? null,
      source: SOURCE,
      updatedAt: new Date(),
    };
  });

  const db = await getDb();
  for (const batch of chunk(rows, 200)) {
    await db.insert(sets).values(batch).onConflictDoUpdate({
      target: sets.id,
      set: {
        name: sql_excluded('name'),
        series: sql_excluded('series'),
        era: sql_excluded('era'),
        releaseDate: sql_excluded('release_date'),
        printedTotal: sql_excluded('printed_total'),
        total: sql_excluded('total'),
        logoUrl: sql_excluded('logo_url'),
        symbolUrl: sql_excluded('symbol_url'),
        updatedAt: new Date(),
      },
    });
  }

  console.log(`Imported ${rows.length} sets.`);

  if (unknownSeries.size > 0) {
    console.warn(
      `\n${unknownSeries.size} series fell through to era 'other' and are not in SERIES_TO_ERA:`,
    );
    for (const s of unknownSeries) console.warn(`  - ${s}`);
    console.warn('Add them to packages/card-data/src/era.ts.');
  } else {
    console.log("Every series in the source is explicitly mapped to an era.");
  }
}

// Drizzle needs `excluded.<col>` to express "the value we tried to insert".
import { sql } from 'drizzle-orm';
function sql_excluded(column: string) {
  return sql.raw(`excluded.${column}`);
}

runScript(main);
