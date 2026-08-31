import { NextResponse } from 'next/server';
import { and, eq, or, ilike, sql, desc, asc, inArray, type SQL } from 'drizzle-orm';
import { getDb } from '@pcs/db';
import { inventoryItems, cards, sets, grades } from '@pcs/db/schema';
import { cents, RARITY_RANK, type RarityTier } from '@pcs/shared';
import { computePrice, gradedValue, dealerBuyOffer } from '@pcs/economy-engine';
import { requirePlayer } from '@/server/session';
import { inventoryValueSql } from '@/server/value-sql';

export const dynamic = 'force-dynamic';

/**
 * The collection, filtered and sorted in SQL.
 *
 * Everything happens server-side and only one page is ever returned: the
 * catalogue is 20,000 cards and a collection can hold thousands, so shipping
 * the lot to the browser to sort it there is exactly what DESIGN.md section 33
 * forbids.
 */

const SORTS = ['acquired', 'price', 'rarity', 'condition', 'name', 'set'] as const;
type Sort = (typeof SORTS)[number];

/** Conditions ordered best-first, so "condition" sorts the way a collector reads it. */
const CONDITION_ORDER = sql`
  case ${inventoryItems.condition}
    when 'near_mint' then 5
    when 'lightly_played' then 4
    when 'moderately_played' then 3
    when 'heavily_played' then 2
    when 'damaged' then 1
    else 0
  end`;

/** Rarity ordered by gameplay rank rather than alphabetically. */
const RARITY_ORDER = sql`
  case ${cards.rarityTier}
    ${sql.raw(
      Object.entries(RARITY_RANK)
        .map(([tier, rank]) => `when '${tier}' then ${rank}`)
        .join(' '),
    )}
    else 0
  end`;

export async function GET(request: Request) {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const setId = url.searchParams.get('setId');
  const rarity = url.searchParams.get('rarity');
  const condition = url.searchParams.get('condition');
  const only = url.searchParams.get('only'); // favorites | graded | duplicates
  const sort = (url.searchParams.get('sort') ?? 'acquired') as Sort;
  const dir = url.searchParams.get('dir') === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
  const pageSize = Math.min(Math.max(1, Number(url.searchParams.get('pageSize') ?? 48)), 120);

  const db = await getDb();

  const filters: SQL[] = [
    eq(inventoryItems.userId, player.id),
    eq(inventoryItems.status, 'owned'),
  ];
  if (setId) filters.push(eq(cards.setId, setId));
  if (rarity) filters.push(eq(cards.rarityTier, rarity));
  if (condition) filters.push(eq(inventoryItems.condition, condition));
  if (only === 'favorites') filters.push(eq(inventoryItems.favorite, true));
  if (only === 'graded') filters.push(sql`${grades.numericGrade} is not null`);
  if (only === 'duplicates') {
    // Cards the player holds more than one owned copy of. A correlated count
    // rather than a join, so the page size and total stay correct.
    filters.push(sql`(
      select count(*) from inventory_items dup
      where dup.card_id = ${inventoryItems.cardId}
        and dup.user_id = ${inventoryItems.userId}
        and dup.status = 'owned'
    ) > 1`);
  }
  if (q) {
    // Name or card number, so "charizard" and "006" both work.
    filters.push(or(ilike(cards.name, `%${q}%`), ilike(cards.number, `%${q}%`))!);
  }

  const where = and(...filters);

  // The grade join is part of the filter for `only=graded`, so it has to be
  // present on the count query too or the two disagree.
  const gradeJoin = and(
    eq(grades.inventoryItemId, inventoryItems.id),
    eq(grades.status, 'completed'),
  );

  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(inventoryItems)
    .leftJoin(cards, eq(cards.id, inventoryItems.cardId))
    .leftJoin(sets, eq(sets.id, cards.setId))
    .leftJoin(grades, gradeJoin)
    .where(where);

  const orderBy = (() => {
    const d = dir === 'asc' ? asc : desc;
    switch (sort) {
      // Sorted on the effective value, so the order matches the number shown
      // on each card rather than its ungraded base price.
      case 'price': return [d(inventoryValueSql()), asc(cards.name)];
      case 'rarity': return [dir === 'asc' ? asc(RARITY_ORDER) : desc(RARITY_ORDER), asc(cards.name)];
      case 'condition': return [dir === 'asc' ? asc(CONDITION_ORDER) : desc(CONDITION_ORDER), asc(cards.name)];
      case 'name': return [d(cards.name)];
      case 'set': return [d(sets.releaseDate), asc(cards.number)];
      default: return [d(inventoryItems.acquiredAt)];
    }
  })();

  const rows = await db
    .select({
      inventoryId: inventoryItems.id,
      condition: inventoryItems.condition,
      acquiredAt: inventoryItems.acquiredAt,
      acquisitionPrice: inventoryItems.acquisitionPrice,
      acquisitionSource: inventoryItems.acquisitionSource,
      favorite: inventoryItems.favorite,
      cardId: cards.id,
      name: cards.name,
      number: cards.number,
      rarityTier: cards.rarityTier,
      imageSmall: cards.imageSmall,
      marketBasePrice: cards.marketBasePrice,
      setId: sets.id,
      setName: sets.name,
      gradeCompany: grades.gradeCompany,
      numericGrade: grades.numericGrade,
      gradeLabel: grades.label,
    })
    .from(inventoryItems)
    .leftJoin(cards, eq(cards.id, inventoryItems.cardId))
    .leftJoin(sets, eq(sets.id, cards.setId))
    .leftJoin(grades, gradeJoin)
    .where(where)
    .orderBy(...orderBy)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const items = rows.map((r) => {
    const raw = computePrice(cents(r.marketBasePrice ?? 0), {
      condition: (r.condition ?? 'near_mint') as never,
    });
    const grade = r.numericGrade != null
      ? {
          company: r.gradeCompany as string,
          numericGrade: r.numericGrade,
          label: r.gradeLabel,
          isBlackLabel: (r.gradeLabel ?? '').includes('Black Label'),
        }
      : null;
    const value = grade ? gradedValue(raw, grade as never) : raw;
    return {
      ...r,
      acquiredAt: new Date(r.acquiredAt).toISOString(),
      grade,
      rawValue: raw,
      value,
      dealerOffer: dealerBuyOffer(value),
    };
  });

  return NextResponse.json({
    items,
    total: Number(total),
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(Number(total) / pageSize)),
  });
}
