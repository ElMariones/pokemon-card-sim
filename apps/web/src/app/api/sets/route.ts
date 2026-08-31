import { NextResponse } from 'next/server';
import { sql, eq, and, desc, asc } from 'drizzle-orm';
import { getDb } from '@pcs/db';
import { sets, cards } from '@pcs/db/schema';

export const dynamic = 'force-dynamic';

/**
 * Sets available to open, newest first.
 *
 * Only sets we hold prices for are offered: a pack whose contents we cannot
 * value would have a meaningless price and a meaningless result screen.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const era = url.searchParams.get('era');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 60), 200);

  const db = await getDb();

  const rows = await db
    .select({
      id: sets.id,
      name: sets.name,
      series: sets.series,
      era: sets.era,
      releaseDate: sets.releaseDate,
      total: sets.total,
      logoUrl: sets.logoUrl,
      symbolUrl: sets.symbolUrl,
      cardCount: sql<number>`count(${cards.id})::int`,
      pricedCount: sql<number>`count(${cards.marketBasePrice})::int`,
      avgPrice: sql<number>`coalesce(avg(${cards.marketBasePrice}), 0)::int`,
    })
    .from(sets)
    .leftJoin(cards, eq(cards.setId, sets.id))
    .where(era ? eq(sets.era, era) : sql`true`)
    .groupBy(sets.id)
    .orderBy(desc(sets.releaseDate))
    .limit(limit);

  return NextResponse.json({
    sets: rows.map((r) => ({ ...r, openable: Number(r.pricedCount) > 0 })),
  });
}
