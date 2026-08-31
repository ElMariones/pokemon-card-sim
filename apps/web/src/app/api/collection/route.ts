import { NextResponse } from 'next/server';
import { and, eq, desc, sql } from 'drizzle-orm';
import { getDb } from '@pcs/db';
import { inventoryItems, cards, sets } from '@pcs/db/schema';
import { requirePlayer } from '@/server/session';

export const dynamic = 'force-dynamic';

/** The player's owned cards. Paginated server-side (DESIGN.md section 33). */
export async function GET(request: Request) {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
  const pageSize = Math.min(Number(url.searchParams.get('pageSize') ?? 60), 200);
  const setId = url.searchParams.get('setId');

  const db = await getDb();
  const where = and(
    eq(inventoryItems.userId, player.id),
    eq(inventoryItems.status, 'owned'),
    setId ? eq(cards.setId, setId) : sql`true`,
  );

  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(inventoryItems)
    .leftJoin(cards, eq(cards.id, inventoryItems.cardId))
    .where(where);

  const items = await db
    .select({
      inventoryId: inventoryItems.id,
      condition: inventoryItems.condition,
      acquiredAt: inventoryItems.acquiredAt,
      cardId: cards.id,
      name: cards.name,
      number: cards.number,
      rarityTier: cards.rarityTier,
      imageSmall: cards.imageSmall,
      marketBasePrice: cards.marketBasePrice,
      setId: sets.id,
      setName: sets.name,
    })
    .from(inventoryItems)
    .leftJoin(cards, eq(cards.id, inventoryItems.cardId))
    .leftJoin(sets, eq(sets.id, cards.setId))
    .where(where)
    .orderBy(desc(inventoryItems.acquiredAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return NextResponse.json({
    items,
    total: Number(total),
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(Number(total) / pageSize)),
  });
}
