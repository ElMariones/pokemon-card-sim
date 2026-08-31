import { NextResponse } from 'next/server';
import { and, eq, desc, sql } from 'drizzle-orm';
import { getDb } from '@pcs/db';
import { inventoryItems, cards, sets, grades } from '@pcs/db/schema';
import { requirePlayer } from '@/server/session';
import { cents } from '@pcs/shared';
import { computePrice, gradedValue, dealerBuyOffer } from '@pcs/economy-engine';

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

  const rows = await db
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
      // Only a collected grade counts. One still in the queue has not come
      // back to the player, so the card is not a slab yet.
      gradeCompany: grades.gradeCompany,
      numericGrade: grades.numericGrade,
      gradeLabel: grades.label,
    })
    .from(inventoryItems)
    .leftJoin(cards, eq(cards.id, inventoryItems.cardId))
    .leftJoin(sets, eq(sets.id, cards.setId))
    .leftJoin(
      grades,
      and(eq(grades.inventoryItemId, inventoryItems.id), eq(grades.status, 'completed')),
    )
    .where(where)
    .orderBy(desc(inventoryItems.acquiredAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  // A graded card is worth its graded value, not its raw value, and the
  // collection must say so — otherwise the grade the player paid for is
  // invisible everywhere except the grading page.
  const items = rows.map((r) => {
    const raw = computePrice(cents(r.marketBasePrice ?? 0), {
      condition: (r.condition ?? 'near_mint') as never,
    });
    const isGraded = r.numericGrade != null;
    const grade = isGraded
      ? {
          company: r.gradeCompany as string,
          numericGrade: r.numericGrade as number,
          label: r.gradeLabel,
          isBlackLabel: (r.gradeLabel ?? '').includes('Black Label'),
        }
      : null;
    const value = grade ? gradedValue(raw, grade as never) : raw;

    return {
      ...r,
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
