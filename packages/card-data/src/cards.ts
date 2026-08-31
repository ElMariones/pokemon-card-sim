import { and, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import { cards, sets } from '../../db/src/schema.js';
import {
  RARITY_RANK,
  type Cents,
  type Confidence,
  type Era,
  type RarityTier,
} from '../../shared/src/index.js';
import { resolveDb, toCount, type CardDataDb } from './client.js';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type CardRecord,
  type CardWithSet,
  type ListCardsFilter,
  type Page,
} from './types.js';

const CARD_COLUMNS = {
  id: cards.id,
  setId: cards.setId,
  number: cards.number,
  name: cards.name,
  rarityRaw: cards.rarityRaw,
  rarityTier: cards.rarityTier,
  supertype: cards.supertype,
  subtypes: cards.subtypes,
  types: cards.types,
  artist: cards.artist,
  imageSmall: cards.imageSmall,
  imageLarge: cards.imageLarge,
  marketBasePrice: cards.marketBasePrice,
  priceConfidence: cards.priceConfidence,
} as const;

type RawCardRow = {
  [K in keyof typeof CARD_COLUMNS]: unknown;
};

function hydrate(row: Record<string, unknown>): CardRecord {
  return {
    id: row.id as string,
    setId: row.setId as string,
    number: row.number as string,
    name: row.name as string,
    rarityRaw: (row.rarityRaw as string | null) ?? null,
    rarityTier: row.rarityTier as RarityTier,
    supertype: (row.supertype as string | null) ?? null,
    subtypes: (row.subtypes as string[] | null) ?? [],
    types: (row.types as string[] | null) ?? [],
    artist: (row.artist as string | null) ?? null,
    imageSmall: (row.imageSmall as string | null) ?? null,
    imageLarge: (row.imageLarge as string | null) ?? null,
    marketBasePrice: (row.marketBasePrice as number | null) as Cents | null,
    priceConfidence: row.priceConfidence as Confidence,
  };
}

function asArray<T>(v: T | T[] | undefined): T[] | undefined {
  if (v === undefined) return undefined;
  const arr = Array.isArray(v) ? v : [v];
  return arr.length ? arr : undefined;
}

function cardsWhere(filter: ListCardsFilter): SQL | undefined {
  const clauses: SQL[] = [];

  const setIds = asArray(filter.setId);
  if (setIds) clauses.push(inArray(cards.setId, setIds));

  const tiers = asArray(filter.rarityTier);
  if (tiers) clauses.push(inArray(cards.rarityTier, tiers));

  if (filter.pricedOnly) clauses.push(isNotNull(cards.marketBasePrice));

  const search = filter.search?.trim();
  if (search) {
    const like = `%${search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    clauses.push(sql`${cards.name} ILIKE ${like}`);
  }

  return clauses.length ? and(...clauses) : undefined;
}

/**
 * Card numbers are text ("1", "10", "SV042", "TG05", "H12"), so a plain text
 * sort puts card 10 before card 2. Order by the leading digit run when there
 * is one, keeping numeric-leading numbers ahead of prefixed ones, and fall
 * back to the raw string to keep the ordering total and stable.
 */
const NUMBER_SORT_KEY = sql`nullif(substring(${cards.number} from '[0-9]{1,9}'), '')::int`;
const NUMERIC_FIRST = sql`(${cards.number} ~ '^[0-9]')`;

/** RARITY_RANK, expressed as SQL so the database can sort by it. */
const RARITY_SORT_KEY: SQL = (() => {
  const branches = Object.entries(RARITY_RANK).map(
    ([tier, rank]) => sql`when ${cards.rarityTier} = ${tier} then ${rank}`,
  );
  return sql`case ${sql.join(branches, sql` `)} else 0 end`;
})();

function cardOrder(filter: ListCardsFilter): SQL[] {
  const desc = filter.direction === 'desc';
  const d = (expr: SQL) => (desc ? sql`${expr} desc` : sql`${expr} asc`);

  switch (filter.sort) {
    case 'name':
      return [d(sql`${cards.name}`), sql`${cards.id} asc`];
    case 'rarity':
      return [d(RARITY_SORT_KEY), sql`${NUMBER_SORT_KEY} asc nulls last`, sql`${cards.id} asc`];
    case 'price':
      // Nulls are "we have no price", never "this is the cheapest card".
      return [
        desc
          ? sql`${cards.marketBasePrice} desc nulls last`
          : sql`${cards.marketBasePrice} asc nulls last`,
        sql`${cards.id} asc`,
      ];
    case 'number':
    default:
      return [
        desc ? sql`${NUMERIC_FIRST} asc` : sql`${NUMERIC_FIRST} desc`,
        desc
          ? sql`${NUMBER_SORT_KEY} desc nulls last`
          : sql`${NUMBER_SORT_KEY} asc nulls last`,
        desc ? sql`${cards.number} desc` : sql`${cards.number} asc`,
      ];
  }
}

function clampPage(filter: ListCardsFilter): { page: number; pageSize: number } {
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(filter.pageSize ?? DEFAULT_PAGE_SIZE)),
  );
  const page = Math.max(1, Math.trunc(filter.page ?? 1));
  return { page, pageSize };
}

/**
 * Paginated, server-filtered card listing.
 *
 * The full catalogue is ~20,000 rows. Every filter, sort and page boundary is
 * applied in SQL and only one page ever leaves the database (DESIGN.md 33).
 * `pageSize` is clamped so a caller cannot request the whole table by asking
 * for `pageSize=999999`.
 */
export async function listCards(
  filter: ListCardsFilter = {},
  dbHandle?: CardDataDb,
): Promise<Page<CardRecord>> {
  const db = await resolveDb(dbHandle);
  const where = cardsWhere(filter);
  const { page, pageSize } = clampPage(filter);

  const countQuery = db.select({ n: sql<number>`count(*)` }).from(cards).$dynamic();
  if (where) countQuery.where(where);
  const total = toCount((await countQuery)[0]?.n);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return { items: [], total, page, pageSize, pageCount };

  const query = db.select(CARD_COLUMNS).from(cards).$dynamic();
  if (where) query.where(where);
  const rows = await query
    .orderBy(...cardOrder(filter))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { items: (rows as RawCardRow[]).map(hydrate), total, page, pageSize, pageCount };
}

/** One card by id, with its parent set attached. */
export async function getCard(id: string, dbHandle?: CardDataDb): Promise<CardWithSet | null> {
  const db = await resolveDb(dbHandle);

  const rows = await db
    .select({
      ...CARD_COLUMNS,
      set_id: sets.id,
      set_name: sets.name,
      set_series: sets.series,
      set_era: sets.era,
      set_releaseDate: sets.releaseDate,
      set_printedTotal: sets.printedTotal,
      set_total: sets.total,
      set_logoUrl: sets.logoUrl,
      set_symbolUrl: sets.symbolUrl,
    })
    .from(cards)
    .innerJoin(sets, eq(cards.setId, sets.id))
    .where(eq(cards.id, id))
    .limit(1);

  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    ...hydrate(row),
    set: {
      id: row.set_id as string,
      name: row.set_name as string,
      series: row.set_series as string,
      era: row.set_era as Era,
      releaseDate: row.set_releaseDate as string,
      printedTotal: row.set_printedTotal as number,
      total: row.set_total as number,
      logoUrl: (row.set_logoUrl as string | null) ?? null,
      symbolUrl: (row.set_symbolUrl as string | null) ?? null,
    },
  };
}

/** How many cards of each rarity tier a set contains. */
export async function countCardsByRarity(
  setId: string,
  dbHandle?: CardDataDb,
): Promise<Array<{ rarityTier: RarityTier; count: number }>> {
  const db = await resolveDb(dbHandle);
  const rows = await db
    .select({ rarityTier: cards.rarityTier, n: sql<number>`count(*)` })
    .from(cards)
    .where(eq(cards.setId, setId))
    .groupBy(cards.rarityTier);

  return rows.map((r) => ({ rarityTier: r.rarityTier as RarityTier, count: toCount(r.n) }));
}
