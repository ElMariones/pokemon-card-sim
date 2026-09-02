import { NextResponse } from 'next/server';
import { and, eq, inArray, desc } from 'drizzle-orm';
import { getDb } from '@pcs/db';
import { cards, sets, inventoryItems, grades } from '@pcs/db/schema';
import { cents, type RarityTier } from '@pcs/shared';
import {
  priceHistory, summarizeHistory, computePrice, dealerBuyOffer, gradedValue,
} from '@pcs/economy-engine';
import { requirePlayer } from '@/server/session';

export const dynamic = 'force-dynamic';

/** Everything the enlarged card view needs, in one round trip. */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ cardId: string }> },
) {
  const { cardId } = await ctx.params;
  const db = await getDb();

  const [card] = await db
    .select({
      id: cards.id,
      name: cards.name,
      number: cards.number,
      rarityRaw: cards.rarityRaw,
      rarityTier: cards.rarityTier,
      supertype: cards.supertype,
      subtypes: cards.subtypes,
      types: cards.types,
      hp: cards.hp,
      artist: cards.artist,
      imageSmall: cards.imageSmall,
      imageLarge: cards.imageLarge,
      marketBasePrice: cards.marketBasePrice,
      priceConfidence: cards.priceConfidence,
      setId: sets.id,
      setName: sets.name,
      setSeries: sets.series,
      setEra: sets.era,
      setLogo: sets.logoUrl,
      setSymbol: sets.symbolUrl,
      releaseDate: sets.releaseDate,
      setTotal: sets.printedTotal,
    })
    .from(cards)
    .innerJoin(sets, eq(sets.id, cards.setId))
    .where(eq(cards.id, cardId))
    .limit(1);

  if (!card) return NextResponse.json({ error: 'No such card' }, { status: 404 });

  const price = cents(card.marketBasePrice ?? 0);
  const history = priceHistory(card.id, price, card.rarityTier as RarityTier, 90);
  const summary = summarizeHistory(history);

  // Ownership is optional: the card view works for a card you do not own, so
  // it can be reached from a set checklist as well as from your collection.
  const player = await requirePlayer();
  let copies: Array<{
    inventoryId: string;
    condition: string | null;
    acquiredAt: string;
    acquisitionPrice: number;
    status: string;
    grade: { company: string; numericGrade: number | null; label: string | null; status: string } | null;
    value: number;
    dealerOffer: number;
  }> = [];

  if (player) {
    const rows = await db
      .select({
        inventoryId: inventoryItems.id,
        condition: inventoryItems.condition,
        acquiredAt: inventoryItems.acquiredAt,
        acquisitionPrice: inventoryItems.acquisitionPrice,
        status: inventoryItems.status,
        gradeCompany: grades.gradeCompany,
        numericGrade: grades.numericGrade,
        gradeLabel: grades.label,
        gradeStatus: grades.status,
      })
      .from(inventoryItems)
      .leftJoin(grades, eq(grades.inventoryItemId, inventoryItems.id))
      .where(
        and(
          eq(inventoryItems.userId, player.id),
          eq(inventoryItems.cardId, cardId),
          inArray(inventoryItems.status, ['owned', 'listed', 'grading']),
        ),
      )
      .orderBy(desc(inventoryItems.acquiredAt));

    copies = rows.map((r) => {
      const raw = computePrice(price, { condition: (r.condition ?? 'near_mint') as never });
      const isGraded = r.numericGrade != null && r.gradeStatus === 'completed';
      const value = isGraded
        ? gradedValue(raw, {
            company: r.gradeCompany as never,
            numericGrade: r.numericGrade!,
            label: r.gradeLabel ?? '',
            isBlackLabel: (r.gradeLabel ?? '').includes('Black Label'),
          })
        : raw;

      return {
        inventoryId: r.inventoryId,
        condition: r.condition,
        acquiredAt: new Date(r.acquiredAt).toISOString(),
        acquisitionPrice: r.acquisitionPrice,
        status: r.status,
        grade: r.gradeCompany
          ? {
              company: r.gradeCompany,
              numericGrade: r.numericGrade,
              label: r.gradeLabel,
              status: r.gradeStatus ?? 'queued',
            }
          : null,
        value,
        dealerOffer: dealerBuyOffer(value),
      };
    });
  }

  return NextResponse.json({
    card: { ...card, marketBasePrice: price },
    history: summary.points,
    summary: {
      low: summary.low,
      high: summary.high,
      first: summary.first,
      last: summary.last,
      changeBp: summary.changeBp,
    },
    copies,
    owned: copies.filter((c) => c.status === 'owned').length,
  });
}
