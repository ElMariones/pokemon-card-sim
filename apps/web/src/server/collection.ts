import { and, eq, sql, desc, asc, inArray } from 'drizzle-orm';
import { getDb } from '@pcs/db';
import { cards, sets, inventoryItems } from '@pcs/db/schema';
import { cents, type Cents, type RarityTier } from '@pcs/shared';

/**
 * Collection queries: what the player owns, measured against the catalogue.
 *
 * These live here rather than in @pcs/card-data because that package is not
 * allowed to know a player exists (CLAUDE.md, package boundaries). Anything
 * joining inventory to the catalogue belongs on the server side of the app.
 *
 * Completion is expressed in basis points, not a float percentage, for the same
 * reason money is: 47/207 has no exact decimal representation and a rounded
 * one accumulates error when summed across 174 sets.
 */

export interface RarityCompletion {
  rarityTier: RarityTier;
  total: number;
  owned: number;
}

export interface SetCompletion {
  setId: string;
  setName: string;
  totalCards: number;
  ownedCards: number;
  ownedCopies: number;
  duplicates: number;
  completionBp: number;
  estimatedSetValue: Cents;
  ownedValue: Cents;
  byRarity: RarityCompletion[];
}

const bpOf = (owned: number, total: number) =>
  total === 0 ? 0 : Math.round((owned / total) * 10_000);

export async function getSetCompletion(
  userId: string,
  setId: string,
): Promise<SetCompletion | null> {
  const db = await getDb();

  // The old implementation issued five serial aggregates before the binder
  // could start. These three independent queries retain the exact semantics
  // while letting the database work overlap.
  const [setRows, ownedRows, rarityRows] = await Promise.all([
    db
      .select({
        id: sets.id,
        name: sets.name,
        totalCards: sql<number>`count(${cards.id})::int`,
        setValue: sql<number>`coalesce(sum(${cards.marketBasePrice}), 0)::int`,
      })
      .from(sets)
      .leftJoin(cards, eq(cards.setId, sets.id))
      .where(eq(sets.id, setId))
      .groupBy(sets.id),
    db
      .select({
        ownedCards: sql<number>`count(distinct ${inventoryItems.cardId})::int`,
        ownedCopies: sql<number>`count(*)::int`,
        ownedValue: sql<number>`coalesce(sum(${cards.marketBasePrice}), 0)::int`,
      })
      .from(inventoryItems)
      .innerJoin(cards, eq(cards.id, inventoryItems.cardId))
      .where(
        and(
          eq(inventoryItems.userId, userId),
          eq(inventoryItems.status, 'owned'),
          eq(cards.setId, setId),
        ),
      ),
    db
      .select({
        tier: cards.rarityTier,
        total: sql<number>`count(distinct ${cards.id})::int`,
        owned: sql<number>`count(distinct ${inventoryItems.cardId})::int`,
      })
      .from(cards)
      .leftJoin(
        inventoryItems,
        and(
          eq(inventoryItems.cardId, cards.id),
          eq(inventoryItems.userId, userId),
          eq(inventoryItems.status, 'owned'),
        ),
      )
      .where(eq(cards.setId, setId))
      .groupBy(cards.rarityTier),
  ]);
  const set = setRows[0];
  if (!set) return null;
  const owned = ownedRows[0];

  const totalCards = Number(set.totalCards ?? 0);
  const ownedCards = Number(owned?.ownedCards ?? 0);
  const ownedCopies = Number(owned?.ownedCopies ?? 0);

  return {
    setId,
    setName: set.name,
    totalCards,
    ownedCards,
    ownedCopies,
    duplicates: Math.max(0, ownedCopies - ownedCards),
    completionBp: bpOf(ownedCards, totalCards),
    estimatedSetValue: cents(Number(set.setValue ?? 0)),
    ownedValue: cents(Number(owned?.ownedValue ?? 0)),
    byRarity: rarityRows
      .map((r) => ({
        rarityTier: r.tier as RarityTier,
        total: Number(r.total),
        owned: Number(r.owned),
      }))
      .sort((a, b) => b.total - a.total),
  };
}

/**
 * Every card in a set with the player's ownership attached — the binder view.
 *
 * A LEFT JOIN from the catalogue, not from inventory, so missing cards appear
 * as gaps. A binder that only showed what you own would not be a checklist.
 */
export interface BinderCard {
  cardId: string;
  number: string;
  name: string;
  rarityTier: RarityTier;
  imageSmall: string | null;
  marketBasePrice: number | null;
  ownedCount: number;
  bestInventoryId: string | null;
  condition: string | null;
}

export async function getBinder(
  userId: string,
  setId: string,
  opts: { ownedOnly?: boolean; missingOnly?: boolean; rarityTier?: string } = {},
): Promise<BinderCard[]> {
  const db = await getDb();

  const rows = await db
    .select({
      cardId: cards.id,
      number: cards.number,
      name: cards.name,
      rarityTier: cards.rarityTier,
      imageSmall: cards.imageSmall,
      marketBasePrice: cards.marketBasePrice,
      ownedCount: sql<number>`count(${inventoryItems.id})::int`,
      bestInventoryId: sql<string | null>`min(${inventoryItems.id})`,
      condition: sql<string | null>`min(${inventoryItems.condition})`,
    })
    .from(cards)
    .leftJoin(
      inventoryItems,
      and(
        eq(inventoryItems.cardId, cards.id),
        eq(inventoryItems.userId, userId),
        eq(inventoryItems.status, 'owned'),
      ),
    )
    .where(
      opts.rarityTier
        ? and(eq(cards.setId, setId), eq(cards.rarityTier, opts.rarityTier))
        : eq(cards.setId, setId),
    )
    .groupBy(cards.id)
    // Card numbers are text ('1', '10', 'TG01', 'SV12'), so a plain sort puts
    // 10 before 2. Sort numerically where a leading number exists, then by text.
    .orderBy(
      sql`nullif(regexp_replace(${cards.number}, '\\D', '', 'g'), '')::bigint nulls last`,
      asc(cards.number),
    );

  const mapped: BinderCard[] = rows.map((r) => ({
    cardId: r.cardId,
    number: r.number,
    name: r.name,
    rarityTier: r.rarityTier as RarityTier,
    imageSmall: r.imageSmall,
    marketBasePrice: r.marketBasePrice,
    ownedCount: Number(r.ownedCount),
    bestInventoryId: r.bestInventoryId,
    condition: r.condition,
  }));

  if (opts.ownedOnly) return mapped.filter((c) => c.ownedCount > 0);
  if (opts.missingOnly) return mapped.filter((c) => c.ownedCount === 0);
  return mapped;
}

/** Headline numbers for the dashboard. */
export interface CollectionStats {
  uniqueCards: number;
  totalCopies: number;
  portfolioValue: Cents;
  setsStarted: number;
  setsCompleted: number;
  bestCard: { name: string; value: Cents; imageSmall: string | null } | null;
}

export async function getCollectionStats(userId: string): Promise<CollectionStats> {
  const db = await getDb();

  const [agg] = await db
    .select({
      uniqueCards: sql<number>`count(distinct ${cards.id})::int`,
      totalCopies: sql<number>`count(*)::int`,
      value: sql<number>`coalesce(sum(${cards.marketBasePrice}), 0)::int`,
      setsStarted: sql<number>`count(distinct ${cards.setId})::int`,
    })
    .from(inventoryItems)
    .innerJoin(cards, eq(cards.id, inventoryItems.cardId))
    .where(and(eq(inventoryItems.userId, userId), eq(inventoryItems.status, 'owned')));

  const [best] = await db
    .select({ name: cards.name, value: cards.marketBasePrice, imageSmall: cards.imageSmall })
    .from(inventoryItems)
    .innerJoin(cards, eq(cards.id, inventoryItems.cardId))
    .where(and(eq(inventoryItems.userId, userId), eq(inventoryItems.status, 'owned')))
    .orderBy(desc(cards.marketBasePrice))
    .limit(1);

  // A set counts as complete when the player owns every card we have for it.
  const completed = await db.execute(sql`
    select count(*)::int as n from (
      select c.set_id
      from cards c
      left join inventory_items i
        on i.card_id = c.id and i.user_id = ${userId} and i.status = 'owned'
      group by c.set_id
      having count(distinct c.id) = count(distinct i.card_id)
         and count(distinct i.card_id) > 0
    ) d
  `);

  return {
    uniqueCards: Number(agg?.uniqueCards ?? 0),
    totalCopies: Number(agg?.totalCopies ?? 0),
    portfolioValue: cents(Number(agg?.value ?? 0)),
    setsStarted: Number(agg?.setsStarted ?? 0),
    setsCompleted: Number((completed.rows[0] as { n?: number })?.n ?? 0),
    bestCard: best
      ? { name: best.name, value: cents(best.value ?? 0), imageSmall: best.imageSmall }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { dealerBuyOffer, computePrice, gradedValue, applyTransaction } from '@pcs/economy-engine';
import { grades } from '@pcs/db/schema';

export interface DuplicateGroup {
  cardId: string;
  name: string;
  number: string;
  rarityTier: RarityTier;
  imageSmall: string | null;
  setName: string;
  owned: number;
  /** How many are surplus, given the number to keep. */
  surplus: number;
  unitValue: Cents;
  unitOffer: Cents;
  surplusOffer: Cents;
}

/**
 * Cards the player holds more than `keep` copies of.
 *
 * Graded and favourited copies are never counted as surplus: a graded copy is
 * a different collectable from its raw twin, and a favourite is an explicit
 * statement that this one is not spare. Selling either as "a duplicate" would
 * destroy something the player deliberately kept.
 */
export async function getDuplicates(userId: string, keep = 1): Promise<DuplicateGroup[]> {
  const db = await getDb();

  const rows = await db
    .select({
      cardId: cards.id,
      name: cards.name,
      number: cards.number,
      rarityTier: cards.rarityTier,
      imageSmall: cards.imageSmall,
      basePrice: cards.marketBasePrice,
      setName: sets.name,
      owned: sql<number>`count(*)::int`,
      // Only plain, unfavourited, ungraded copies can be surplus.
      spare: sql<number>`
        count(*) filter (
          where ${inventoryItems.favorite} = false
            and ${grades.numericGrade} is null
        )::int`,
      worstCondition: sql<string>`min(${inventoryItems.condition})`,
    })
    .from(inventoryItems)
    .innerJoin(cards, eq(cards.id, inventoryItems.cardId))
    .innerJoin(sets, eq(sets.id, cards.setId))
    .leftJoin(
      grades,
      and(eq(grades.inventoryItemId, inventoryItems.id), eq(grades.status, 'completed')),
    )
    .where(and(eq(inventoryItems.userId, userId), eq(inventoryItems.status, 'owned')))
    .groupBy(cards.id, sets.name)
    .having(sql`count(*) > ${keep}`)
    .orderBy(desc(sql`count(*)`));

  return rows
    .map((r) => {
      const owned = Number(r.owned);
      const spare = Number(r.spare);
      // Keep `keep` copies overall, and never dip into protected ones.
      const surplus = Math.max(0, Math.min(spare, owned - keep));
      const unitValue = computePrice(cents(r.basePrice ?? 0), { condition: 'near_mint' });
      const unitOffer = dealerBuyOffer(unitValue);
      return {
        cardId: r.cardId,
        name: r.name,
        number: r.number,
        rarityTier: r.rarityTier as RarityTier,
        imageSmall: r.imageSmall,
        setName: r.setName,
        owned,
        surplus,
        unitValue,
        unitOffer,
        surplusOffer: cents(unitOffer * surplus),
      };
    })
    .filter((g) => g.surplus > 0);
}

export interface BatchSaleResult {
  soldCount: number;
  proceeds: Cents;
  balanceAfter: Cents;
  cards: { name: string; count: number; each: Cents }[];
}

/**
 * Sell every surplus copy to the dealer in one go.
 *
 * The whole batch writes ONE ledger entry rather than one per card. A batch of
 * three hundred bulk commons is a single decision and a single payment; three
 * hundred rows would bury the ledger without telling anyone anything the
 * metadata does not already record.
 */
export async function sellDuplicates(
  userId: string,
  keep = 1,
  onlyCardIds?: string[],
): Promise<BatchSaleResult> {
  const db = await getDb();
  const groups = (await getDuplicates(userId, keep)).filter(
    (g) => !onlyCardIds || onlyCardIds.includes(g.cardId),
  );

  if (groups.length === 0) {
    return { soldCount: 0, proceeds: cents(0), balanceAfter: cents(0), cards: [] };
  }

  const toSell: string[] = [];
  const summary: { name: string; count: number; each: Cents }[] = [];
  let proceeds = 0;

  for (const g of groups) {
    // Re-read the actual sellable copies rather than trusting the aggregate,
    // and take the worst-conditioned ones first so the best copy is kept.
    const copies = await db
      .select({ id: inventoryItems.id, condition: inventoryItems.condition })
      .from(inventoryItems)
      .leftJoin(
        grades,
        and(eq(grades.inventoryItemId, inventoryItems.id), eq(grades.status, 'completed')),
      )
      .where(
        and(
          eq(inventoryItems.userId, userId),
          eq(inventoryItems.cardId, g.cardId),
          eq(inventoryItems.status, 'owned'),
          eq(inventoryItems.favorite, false),
          sql`${grades.numericGrade} is null`,
        ),
      )
      .orderBy(
        sql`case ${inventoryItems.condition}
              when 'damaged' then 1 when 'heavily_played' then 2
              when 'moderately_played' then 3 when 'lightly_played' then 4
              else 5 end`,
      );

    const take = copies.slice(0, Math.max(0, copies.length - Math.max(0, keep)));
    if (take.length === 0) continue;

    for (const c of take) {
      const value = computePrice(g.unitValue, {
        condition: (c.condition ?? 'near_mint') as never,
      });
      proceeds += dealerBuyOffer(value);
      toSell.push(c.id);
    }
    summary.push({ name: g.name, count: take.length, each: g.unitOffer });
  }

  if (toSell.length === 0) {
    return { soldCount: 0, proceeds: cents(0), balanceAfter: cents(0), cards: [] };
  }

  await db
    .update(inventoryItems)
    .set({ status: 'sold' })
    .where(inArray(inventoryItems.id, toSell));

  const { balanceAfter } = await applyTransaction(db as never, {
    userId,
    type: 'card_sale',
    amount: cents(proceeds),
    itemType: 'batch',
    itemId: null as never,
    metadata: {
      via: 'bulk_duplicates',
      count: toSell.length,
      keep,
      cards: summary.map((s) => ({ name: s.name, count: s.count })),
    },
  });

  return {
    soldCount: toSell.length,
    proceeds: cents(proceeds),
    balanceAfter,
    cards: summary,
  };
}
