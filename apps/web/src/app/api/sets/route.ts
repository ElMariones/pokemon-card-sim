import { NextResponse } from 'next/server';
import { sql, eq, desc } from 'drizzle-orm';
import { getDb } from '@pcs/db';
import { sets, cards, packTemplates, inventoryItems } from '@pcs/db/schema';
import { requirePlayer } from '@/server/session';
import { toRarityTier, type ChaseCard } from '@/lib/shelf';

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
  const player = await requirePlayer();

  // How much of each set the player already holds, so the shop can say what a
  // pack would actually add. Zero for a visitor without a session.
  const ownedCards = player
    ? sql<number>`(
        select count(distinct i.card_id)::int
        from ${inventoryItems} i
        join ${cards} oc on oc.id = i.card_id
        where oc.set_id = ${sets.id}
          and i.user_id = ${player.id}
          and i.status = 'owned'
      )`
    : sql<number>`0::int`;

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
      // What a pack costs, so the shop can show it before the player commits.
      // The sealed market first, the contents derivation only where no market
      // covers the set.
      packPrice: sql<number>`coalesce(max(${packTemplates.marketBasePrice}), max(${packTemplates.simulatorPrice}), 0)::int`,
      packPriceConfidence: sql<string>`max(${packTemplates.priceConfidence})`,
      packSize: sql<number>`coalesce(max(${packTemplates.cardsPerPack}), 0)::int`,
      pullConfidence: sql<string>`max(${packTemplates.confidence})`,
      ownedCards,
    })
    .from(sets)
    .leftJoin(cards, eq(cards.setId, sets.id))
    .leftJoin(packTemplates, eq(packTemplates.setId, sets.id))
    .where(era ? eq(sets.era, era) : sql`true`)
    .groupBy(sets.id)
    .orderBy(desc(sets.releaseDate))
    .limit(limit);

  // The best card a pack of each set can actually produce.
  //
  // Kept out of the aggregate above deliberately: it is a per-set top-1, and
  // `distinct on` answers that in one indexed pass instead of a correlated
  // subquery evaluated once per row.
  //
  // `promo` and `unknown` are excluded because no pull table gives them
  // weight (see deriveTemplate) — offering a card no pack can yield as the
  // reason to buy the pack would be a lie.
  const setIds = rows.map((r) => r.id);
  const chaseBySet = new Map<string, ChaseCard>();
  if (setIds.length > 0) {
    const chase = await db.execute(sql`
      select distinct on (c.set_id)
        c.set_id, c.id, c.name, c.number, c.rarity_tier, c.image_small,
        c.market_base_price
      from ${cards} c
      where c.set_id in (${sql.join(setIds.map((id) => sql`${id}`), sql`, `)})
        and c.market_base_price is not null
        and c.market_base_price > 0
        and c.rarity_tier not in ('promo', 'unknown')
      order by c.set_id, c.market_base_price desc, c.number
    `);
    for (const row of chase.rows as unknown as ChaseRow[]) {
      chaseBySet.set(row.set_id, {
        id: row.id,
        name: row.name,
        number: row.number,
        rarityTier: toRarityTier(row.rarity_tier),
        imageSmall: row.image_small,
        price: Number(row.market_base_price),
      });
    }
  }

  return NextResponse.json({
    sets: rows.map((r) => ({
      ...r,
      chase: chaseBySet.get(r.id) ?? null,
      openable: Number(r.pricedCount) > 0 && Number(r.packPrice) > 0,
    })),
  });
}

interface ChaseRow {
  set_id: string;
  id: string;
  name: string;
  number: string;
  rarity_tier: string;
  image_small: string | null;
  market_base_price: number;
}
