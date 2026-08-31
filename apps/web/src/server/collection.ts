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

  const [set] = await db
    .select({ id: sets.id, name: sets.name })
    .from(sets)
    .where(eq(sets.id, setId))
    .limit(1);
  if (!set) return null;

  const [totals] = await db
    .select({
      totalCards: sql<number>`count(*)::int`,
      setValue: sql<number>`coalesce(sum(${cards.marketBasePrice}), 0)::int`,
    })
    .from(cards)
    .where(eq(cards.setId, setId));

  const [owned] = await db
    .select({
      ownedCards: sql<number>`count(distinct ${cards.id})::int`,
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
    );

  const rarityTotals = await db
    .select({ tier: cards.rarityTier, n: sql<number>`count(*)::int` })
    .from(cards)
    .where(eq(cards.setId, setId))
    .groupBy(cards.rarityTier);

  const rarityOwned = await db
    .select({ tier: cards.rarityTier, n: sql<number>`count(distinct ${cards.id})::int` })
    .from(inventoryItems)
    .innerJoin(cards, eq(cards.id, inventoryItems.cardId))
    .where(
      and(
        eq(inventoryItems.userId, userId),
        eq(inventoryItems.status, 'owned'),
        eq(cards.setId, setId),
      ),
    )
    .groupBy(cards.rarityTier);

  const ownedByTier = new Map(rarityOwned.map((r) => [r.tier, Number(r.n)]));

  const totalCards = Number(totals?.totalCards ?? 0);
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
    estimatedSetValue: cents(Number(totals?.setValue ?? 0)),
    ownedValue: cents(Number(owned?.ownedValue ?? 0)),
    byRarity: rarityTotals
      .map((r) => ({
        rarityTier: r.tier as RarityTier,
        total: Number(r.n),
        owned: ownedByTier.get(r.tier) ?? 0,
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
