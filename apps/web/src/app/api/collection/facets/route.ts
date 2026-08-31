import { NextResponse } from 'next/server';
import { and, eq, sql, desc } from 'drizzle-orm';
import { getDb } from '@pcs/db';
import { inventoryItems, cards, sets } from '@pcs/db/schema';
import { requirePlayer } from '@/server/session';

export const dynamic = 'force-dynamic';

/**
 * Which sets, rarities and conditions the player actually holds.
 *
 * The filter menus are built from this rather than from the whole catalogue,
 * so they never offer a choice that returns nothing.
 */
export async function GET() {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: 'No session' }, { status: 401 });

  const db = await getDb();
  const where = and(eq(inventoryItems.userId, player.id), eq(inventoryItems.status, 'owned'));

  const [bySet, byRarity, byCondition, favourites] = await Promise.all([
    db.select({
        setId: sets.id, setName: sets.name, n: sql<number>`count(*)::int`,
      })
      .from(inventoryItems)
      .innerJoin(cards, eq(cards.id, inventoryItems.cardId))
      .innerJoin(sets, eq(sets.id, cards.setId))
      .where(where)
      .groupBy(sets.id, sets.name)
      .orderBy(desc(sql`count(*)`)),
    db.select({ rarityTier: cards.rarityTier, n: sql<number>`count(*)::int` })
      .from(inventoryItems)
      .innerJoin(cards, eq(cards.id, inventoryItems.cardId))
      .where(where)
      .groupBy(cards.rarityTier),
    db.select({ condition: inventoryItems.condition, n: sql<number>`count(*)::int` })
      .from(inventoryItems)
      .where(where)
      .groupBy(inventoryItems.condition),
    db.select({ n: sql<number>`count(*)::int` })
      .from(inventoryItems)
      .where(and(where, eq(inventoryItems.favorite, true))),
  ]);

  return NextResponse.json({
    sets: bySet,
    rarities: byRarity.map((r) => ({ ...r, n: Number(r.n) })),
    conditions: byCondition.filter((c) => c.condition),
    favorites: Number(favourites[0]?.n ?? 0),
  });
}
