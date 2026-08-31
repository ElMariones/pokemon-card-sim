/**
 * Import every card in every set.
 *
 * Source: PokemonTCG/pokemon-tcg-data bulk JSON, one file per set. No rate
 * limit and no API key, which is why the catalogue comes from here rather than
 * from paging the live API 20,000 cards at a time.
 *
 * Idempotent and resumable: safe to interrupt and re-run.
 *
 *   npx tsx scripts/import/import-cards.ts               # everything
 *   npx tsx scripts/import/import-cards.ts --set=base1   # one set
 *   npx tsx scripts/import/import-cards.ts --limit=10    # first 10 sets
 *   npx tsx scripts/import/import-cards.ts --missing     # only empty sets
 */
import { sql, eq } from 'drizzle-orm';
import { getDb, assertNotLocked } from '../../packages/db/src/index';
import { sets, cards } from '../../packages/db/src/schema';
import { normalizeRarity } from '../../packages/shared/src/index';
import { fetchJson, NotFoundError, chunk, parseArgs, runScript } from './http';

const CARDS_URL = (setId: string) =>
  `https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/cards/en/${setId}.json`;
const SOURCE = 'pokemon-tcg-data';
const BATCH = 400;

interface SourceCard {
  id: string;
  name: string;
  number?: string;
  supertype?: string;
  subtypes?: string[];
  types?: string[];
  hp?: string;
  artist?: string;
  rarity?: string;
  nationalPokedexNumbers?: number[];
  images?: { small?: string; large?: string };
}

const excluded = (column: string) => sql.raw(`excluded.${column}`);

async function main() {
  assertNotLocked();
  const args = parseArgs();
  const db = await getDb();

  let setRows = await db
    .select({ id: sets.id, name: sets.name })
    .from(sets)
    .orderBy(sets.releaseDate);

  if (typeof args.set === 'string') {
    setRows = setRows.filter((s) => s.id === args.set);
    if (setRows.length === 0) throw new Error(`No such set: ${args.set}`);
  }

  if (args.missing) {
    const counts = await db
      .select({ setId: cards.setId, n: sql<number>`count(*)::int` })
      .from(cards)
      .groupBy(cards.setId);
    const have = new Set(counts.filter((c) => Number(c.n) > 0).map((c) => c.setId));
    setRows = setRows.filter((s) => !have.has(s.id));
  }

  if (typeof args.limit === 'string') setRows = setRows.slice(0, Number(args.limit));

  console.log(`Importing cards for ${setRows.length} sets...\n`);

  let totalCards = 0;
  const failed: string[] = [];
  const unmappedRarities = new Map<string, number>();

  for (const [i, set] of setRows.entries()) {
    const label = `[${String(i + 1).padStart(3)}/${setRows.length}] ${set.id}`;
    let source: SourceCard[];

    try {
      source = await fetchJson<SourceCard[]>(CARDS_URL(set.id));
    } catch (err) {
      if (err instanceof NotFoundError) {
        console.warn(`${label} no card file published — skipping`);
      } else {
        console.error(`${label} FAILED: ${(err as Error).message}`);
      }
      failed.push(set.id);
      continue;
    }

    const seen = new Set<string>();
    const rows = [];

    for (const c of source) {
      // A handful of source files repeat a (set, number) pair. The unique
      // index would reject the whole batch, so drop repeats and keep the first.
      const key = c.number ?? c.id;
      if (seen.has(key)) continue;
      seen.add(key);

      const tier = normalizeRarity({
        rarity: c.rarity,
        supertype: c.supertype,
        subtypes: c.subtypes,
      });
      if (tier === 'unknown' && c.rarity) {
        unmappedRarities.set(c.rarity, (unmappedRarities.get(c.rarity) ?? 0) + 1);
      }

      rows.push({
        id: c.id,
        setId: set.id,
        number: c.number ?? c.id,
        name: c.name,
        rarityRaw: c.rarity ?? null,
        rarityTier: tier,
        supertype: c.supertype ?? null,
        subtypes: c.subtypes ?? [],
        types: c.types ?? [],
        hp: c.hp ?? null,
        artist: c.artist ?? null,
        nationalPokedexNumbers: c.nationalPokedexNumbers ?? [],
        imageSmall: c.images?.small ?? null,
        imageLarge: c.images?.large ?? null,
        source: SOURCE,
        updatedAt: new Date(),
      });
    }

    for (const batch of chunk(rows, BATCH)) {
      await db.insert(cards).values(batch).onConflictDoUpdate({
        target: cards.id,
        set: {
          name: excluded('name'),
          rarityRaw: excluded('rarity_raw'),
          rarityTier: excluded('rarity_tier'),
          supertype: excluded('supertype'),
          subtypes: excluded('subtypes'),
          types: excluded('types'),
          hp: excluded('hp'),
          artist: excluded('artist'),
          nationalPokedexNumbers: excluded('national_pokedex_numbers'),
          imageSmall: excluded('image_small'),
          imageLarge: excluded('image_large'),
          updatedAt: new Date(),
        },
      });
    }

    totalCards += rows.length;
    console.log(`${label} ${String(rows.length).padStart(4)} cards  ${set.name}`);
  }

  console.log(`\nImported ${totalCards} cards across ${setRows.length - failed.length} sets.`);
  if (failed.length) console.warn(`${failed.length} sets had no card data: ${failed.join(', ')}`);

  if (unmappedRarities.size > 0) {
    console.warn(`\n${unmappedRarities.size} rarity strings are not in RARITY_STRING_TO_TIER:`);
    for (const [r, n] of [...unmappedRarities].sort((a, b) => b[1] - a[1])) {
      console.warn(`  ${String(n).padStart(5)}x  ${r}`);
    }
    console.warn('Add them to packages/shared/src/rarity-map.ts.');
  }
}

runScript(main);
