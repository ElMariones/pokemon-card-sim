import { and, asc, desc, eq, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { cards, sets } from '../../db/src/schema.js';
import type { Era } from '../../shared/src/index.js';
import { resolveDb, toCount, type CardDataDb } from './client.js';
import type { ListSetsFilter, SetRecord } from './types.js';

const SET_COLUMNS = {
  id: sets.id,
  name: sets.name,
  series: sets.series,
  era: sets.era,
  releaseDate: sets.releaseDate,
  printedTotal: sets.printedTotal,
  total: sets.total,
  logoUrl: sets.logoUrl,
  symbolUrl: sets.symbolUrl,
} as const;

function asArray<T>(v: T | T[] | undefined): T[] | undefined {
  if (v === undefined) return undefined;
  const arr = Array.isArray(v) ? v : [v];
  return arr.length ? arr : undefined;
}

function setsWhere(filter: ListSetsFilter): SQL | undefined {
  const clauses: SQL[] = [];

  const eras = asArray(filter.era);
  if (eras) clauses.push(inArray(sets.era, eras));

  const series = asArray(filter.series);
  if (series) clauses.push(inArray(sets.series, series));

  if (filter.releasedFrom) clauses.push(gte(sets.releaseDate, filter.releasedFrom));
  if (filter.releasedTo) clauses.push(lte(sets.releaseDate, filter.releasedTo));

  const search = filter.search?.trim();
  if (search) {
    const like = `%${search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    const match = or(
      sql`${sets.name} ILIKE ${like}`,
      sql`${sets.series} ILIKE ${like}`,
      sql`${sets.id} ILIKE ${like}`,
    );
    if (match) clauses.push(match);
  }

  return clauses.length ? and(...clauses) : undefined;
}

function setOrder(filter: ListSetsFilter, countExpr: SQL<number>) {
  const dir = filter.direction === 'desc' ? desc : asc;
  switch (filter.sort) {
    case 'name':
      return [dir(sets.name)];
    case 'cardCount':
      return [dir(countExpr), asc(sets.releaseDate)];
    case 'releaseDate':
    default:
      return [dir(sets.releaseDate), asc(sets.id)];
  }
}

/**
 * List sets, filtered and ordered in the database.
 *
 * There are only ~170 sets so this is not paginated, but the filtering still
 * happens server-side: DESIGN.md section 33 forbids shipping the catalogue to
 * the browser and doing it there, and the same rule that governs 20,000 cards
 * should not be quietly suspended for their parents.
 */
export async function listSets(
  filter: ListSetsFilter = {},
  dbHandle?: CardDataDb,
): Promise<SetRecord[]> {
  const db = await resolveDb(dbHandle);
  const where = setsWhere(filter);
  const needsCounts = filter.withCounts || filter.nonEmptyOnly || filter.sort === 'cardCount';

  if (!needsCounts) {
    const query = db.select(SET_COLUMNS).from(sets).$dynamic();
    if (where) query.where(where);
    const rows = await query.orderBy(...setOrder(filter, sql<number>`0`));
    return rows.map((r) => ({ ...r, era: r.era as Era }));
  }

  const countExpr = sql<number>`count(${cards.id})`;
  const query = db
    .select({ ...SET_COLUMNS, cardCount: countExpr })
    .from(sets)
    .leftJoin(cards, eq(cards.setId, sets.id))
    .$dynamic();

  if (where) query.where(where);
  query.groupBy(sets.id);
  if (filter.nonEmptyOnly) query.having(sql`count(${cards.id}) > 0`);

  const rows = await query.orderBy(...setOrder(filter, countExpr));
  return rows.map((r) => ({ ...r, era: r.era as Era, cardCount: toCount(r.cardCount) }));
}

/** One set by id, with the number of cards we actually imported for it. */
export async function getSet(id: string, dbHandle?: CardDataDb): Promise<SetRecord | null> {
  const db = await resolveDb(dbHandle);

  const rows = await db
    .select({ ...SET_COLUMNS, cardCount: sql<number>`count(${cards.id})` })
    .from(sets)
    .leftJoin(cards, eq(cards.setId, sets.id))
    .where(eq(sets.id, id))
    .groupBy(sets.id);

  const row = rows[0];
  if (!row) return null;
  return { ...row, era: row.era as Era, cardCount: toCount(row.cardCount) };
}

/** Set counts per era, for navigation chrome. */
export async function countSetsByEra(
  dbHandle?: CardDataDb,
): Promise<Array<{ era: Era; sets: number; cards: number }>> {
  const db = await resolveDb(dbHandle);
  const rows = await db
    .select({
      era: sets.era,
      setCount: sql<number>`count(distinct ${sets.id})`,
      cardCount: sql<number>`count(${cards.id})`,
    })
    .from(sets)
    .leftJoin(cards, eq(cards.setId, sets.id))
    .groupBy(sets.era);

  return rows.map((r) => ({
    era: r.era as Era,
    sets: toCount(r.setCount),
    cards: toCount(r.cardCount),
  }));
}
