import { createHash, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { getDb, type Database } from '@pcs/db';
import {
  cards,
  grades,
  inventoryItems,
  marketState,
  npcNegotiations,
  npcShopRotations,
  npcShopStock,
  sets,
} from '@pcs/db/schema';
import {
  applyTransactionInTx,
  bp,
  computePrice,
  demandBandForDelay,
  gradedValue,
  InsufficientFundsError,
  mulberry32,
  offerRisk,
  otherBuyerDelaySeconds,
  priceNpcStock,
  resolveNpcOffer,
  rollGrade,
  rollMarketCondition,
  tradeCredit,
  type GradeCompany,
} from '@pcs/economy-engine';
import {
  cents,
  CONDITION_LABEL,
  type Cents,
  type Condition,
  type RarityTier,
} from '@pcs/shared';
import { GameError } from './game';
import { DEALERS, dealerById, type DealerProfile } from './npc-dealers';

const STOCK_SIZE = 6;
const HOLD_MS = 5 * 60 * 1_000;
const MIN_STOCK_VALUE = cents(200);

// The transaction callback types of the PGlite and Neon drivers are mutually
// incompatible even though the query surface used here is identical.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbLike = any;

export interface WantedCriteria {
  eras: string[];
  rarityTiers: string[];
  wantsGraded: boolean;
  exactCardIds: string[];
}

export interface NpcStockView {
  id: string;
  shopId: string;
  cardId: string;
  name: string;
  number: string;
  setName: string;
  rarityTier: RarityTier;
  imageSmall: string | null;
  imageLarge: string | null;
  condition: Condition;
  conditionLabel: string;
  grade: { company: string; numericGrade: number; label: string; isBlackLabel: boolean } | null;
  marketValue: Cents;
  askPrice: Cents;
  priceConfidence: string;
  demandBand: string;
  isNew: boolean;
}

export interface TradeCardView {
  inventoryId: string;
  cardId: string;
  name: string;
  setName: string;
  imageSmall: string | null;
  condition: Condition;
  grade: { company: string; numericGrade: number; label: string; isBlackLabel: boolean } | null;
  marketValue: Cents;
  credit: Cents;
  exactWishlist: boolean;
  favorite: boolean;
}

function seedFrom(value: string): number {
  return createHash('sha256').update(value).digest().readUInt32LE(0);
}

function datePlus(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}

function between(rng: () => number, [min, max]: readonly [number, number]): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function gradeCompany(rng: () => number): GradeCompany {
  const roll = rng();
  return roll < 0.48 ? 'PSA' : roll < 0.78 ? 'BGS' : 'CGC';
}

function effectiveValue(
  base: Cents,
  condition: Condition,
  grade: { company: string | null; numericGrade: number | null; label: string | null; isBlackLabel?: boolean },
): Cents {
  const raw = computePrice(base, { condition });
  if (!grade.company || grade.numericGrade == null) return raw;
  return gradedValue(raw, {
    company: grade.company as GradeCompany,
    numericGrade: grade.numericGrade,
    label: grade.label ?? '',
    isBlackLabel: grade.isBlackLabel ?? (grade.label ?? '').includes('Black Label'),
  });
}

async function settleElapsedStock(userId: string, now: Date, database: DbLike): Promise<void> {
  // Expired holds first become available; the already-fixed buyer timestamp can
  // then settle in the same read.
  const expiredHolds = await database
    .select({ id: npcShopStock.id })
    .from(npcShopStock)
    .where(and(
      eq(npcShopStock.userId, userId),
      eq(npcShopStock.status, 'held'),
      lte(npcShopStock.holdUntil, now),
    ));

  if (expiredHolds.length > 0) {
    const ids = expiredHolds.map((row: { id: string }) => row.id);
    await database.update(npcShopStock).set({
      status: 'available', holdUserId: null, holdUntil: null,
    }).where(inArray(npcShopStock.id, ids));
    await database.update(npcNegotiations).set({ status: 'expired', updatedAt: now })
      .where(and(inArray(npcNegotiations.stockId, ids), eq(npcNegotiations.status, 'active')));
  }

  await database.update(npcShopStock).set({
    status: 'sold_to_npc', resolvedAt: now,
  }).where(and(
    eq(npcShopStock.userId, userId),
    eq(npcShopStock.status, 'available'),
    lte(npcShopStock.otherBuyerAt, now),
  ));
}

async function latestRotation(userId: string, shopId: string, database: DbLike) {
  const [row] = await database.select().from(npcShopRotations)
    .where(and(eq(npcShopRotations.userId, userId), eq(npcShopRotations.shopId, shopId)))
    .orderBy(desc(npcShopRotations.rotationNumber)).limit(1);
  return row ?? null;
}

async function candidateCards(profile: DealerProfile, rotationId: string, database: DbLike) {
  const filters = [
    isNotNull(cards.marketBasePrice),
    gte(cards.marketBasePrice, MIN_STOCK_VALUE),
    inArray(cards.rarityTier, [...profile.rarityTiers]),
  ];
  if (profile.eras.length > 0) filters.push(inArray(sets.era, [...profile.eras]));

  return database.select({
    id: cards.id,
    name: cards.name,
    rarityTier: cards.rarityTier,
    basePrice: sql<number>`coalesce(${marketState.currentPrice}, ${cards.marketBasePrice})::int`,
    era: sets.era,
  }).from(cards)
    .innerJoin(sets, eq(sets.id, cards.setId))
    .leftJoin(marketState, eq(marketState.cardId, cards.id))
    .where(and(...filters))
    .orderBy(sql`md5(${cards.id} || ${rotationId})`)
    .limit(240);
}

async function createRotation(
  userId: string,
  profile: DealerProfile,
  previous: Awaited<ReturnType<typeof latestRotation>>,
  now: Date,
  database: DbLike,
): Promise<void> {
  const rotationId = randomUUID();
  const rotationNumber = (previous?.rotationNumber ?? 0) + 1;
  const refreshAt = datePlus(now, profile.refreshHours * 60 * 60 * 1_000);
  const candidates = await candidateCards(profile, rotationId, database);
  if (candidates.length === 0) return;

  // Rotate one quarter of stale stock deterministically. Anything held remains
  // untouched; resolving a negotiation matters more than the shop clock.
  const oldAvailable = await database.select({ id: npcShopStock.id })
    .from(npcShopStock)
    .where(and(
      eq(npcShopStock.userId, userId),
      eq(npcShopStock.shopId, profile.id),
      eq(npcShopStock.status, 'available'),
    )).orderBy(asc(npcShopStock.createdAt));
  const toRotate = oldAvailable
    .filter((row: { id: string }) => seedFrom(`${rotationId}:${row.id}`) % 4 === 0)
    .map((row: { id: string }) => row.id);
  if (toRotate.length > 0) {
    await database.update(npcShopStock).set({ status: 'rotated', resolvedAt: now })
      .where(inArray(npcShopStock.id, toRotate));
  }

  const remainingRows = await database.select({
    id: npcShopStock.id,
    cardId: npcShopStock.cardId,
  }).from(npcShopStock).where(and(
    eq(npcShopStock.userId, userId),
    eq(npcShopStock.shopId, profile.id),
    inArray(npcShopStock.status, ['available', 'held']),
  ));
  const remainingIds = new Set(remainingRows.map((row: { cardId: string }) => row.cardId));
  const availableCandidates = candidates.filter((candidate: { id: string }) => !remainingIds.has(candidate.id));
  const exactCardIds = availableCandidates.slice(0, 2).map((candidate: { id: string }) => candidate.id);
  const wantedCriteria: WantedCriteria = {
    eras: profile.eras.length > 0 ? [...profile.eras] : ['classic', 'neo', 'ex', 'bw', 'xy', 'sm', 'swsh', 'sv', 'me'],
    rarityTiers: profile.id === 'jules-slabs'
      ? ['holo_rare', 'ultra_rare', 'secret_rare']
      : [...profile.rarityTiers],
    wantsGraded: profile.id === 'jules-slabs' || profile.gradedChance >= 0.25,
    exactCardIds,
  };

  const needed = Math.max(0, STOCK_SIZE - remainingRows.length);
  const stockRows: (typeof npcShopStock.$inferInsert)[] = [];
  for (const candidate of availableCandidates) {
    if (stockRows.length >= needed) break;
    const stockId = randomUUID();
    const rng = mulberry32(seedFrom(`${rotationId}:${candidate.id}:${stockRows.length}`));
    const condition = rollMarketCondition(rng);
    const isGraded = rng() < profile.gradedChance;
    const rolledGrade = isGraded ? rollGrade(gradeCompany(rng), condition, rng) : null;
    const marketValue = effectiveValue(cents(candidate.basePrice), condition, {
      company: rolledGrade?.company ?? null,
      numericGrade: rolledGrade?.numericGrade ?? null,
      label: rolledGrade?.label ?? null,
      isBlackLabel: rolledGrade?.isBlackLabel,
    });
    if (marketValue < MIN_STOCK_VALUE) continue;

    const priced = priceNpcStock({
      marketValue,
      markupBp: bp(between(rng, profile.markupBp)),
      floorBp: bp(between(rng, profile.floorBp)),
    });
    const delay = otherBuyerDelaySeconds({
      askPrice: priced.askPrice,
      marketValue,
      rarityTier: candidate.rarityTier as RarityTier,
      graded: isGraded,
      trafficBp: profile.trafficBp,
      rng,
    });
    stockRows.push({
      id: stockId,
      rotationId,
      userId,
      shopId: profile.id,
      slot: stockRows.length,
      cardId: candidate.id,
      condition,
      gradeCompany: rolledGrade?.company ?? null,
      numericGrade: rolledGrade?.numericGrade ?? null,
      gradeLabel: rolledGrade?.label ?? null,
      isBlackLabel: rolledGrade?.isBlackLabel ?? false,
      marketValue,
      askPrice: priced.askPrice,
      sellerFloor: priced.sellerFloor,
      demandBand: demandBandForDelay(delay),
      otherBuyerAt: datePlus(now, delay * 1_000),
      status: 'available',
      createdAt: now,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await database.transaction(async (tx: any) => {
    await tx.insert(npcShopRotations).values({
      id: rotationId,
      userId,
      shopId: profile.id,
      rotationNumber,
      wantedCriteria,
      startedAt: now,
      refreshAt,
    });
    if (stockRows.length > 0) await tx.insert(npcShopStock).values(stockRows);
  });
}

async function ensureRotations(userId: string, now: Date, database: DbLike): Promise<void> {
  for (const profile of DEALERS) {
    const latest = await latestRotation(userId, profile.id, database);
    if (!latest || new Date(latest.refreshAt) <= now) {
      await createRotation(userId, profile, latest, now, database);
    }
  }
}

export async function getNpcMarket(userId: string, database?: Database) {
  const db = database ?? await getDb();
  const now = new Date();
  await settleElapsedStock(userId, now, db);
  await ensureRotations(userId, now, db);

  const stock = await db.select({
    id: npcShopStock.id,
    shopId: npcShopStock.shopId,
    cardId: cards.id,
    name: cards.name,
    number: cards.number,
    setName: sets.name,
    rarityTier: cards.rarityTier,
    imageSmall: cards.imageSmall,
    imageLarge: cards.imageLarge,
    priceConfidence: cards.priceConfidence,
    condition: npcShopStock.condition,
    gradeCompany: npcShopStock.gradeCompany,
    numericGrade: npcShopStock.numericGrade,
    gradeLabel: npcShopStock.gradeLabel,
    isBlackLabel: npcShopStock.isBlackLabel,
    marketValue: npcShopStock.marketValue,
    askPrice: npcShopStock.askPrice,
    demandBand: npcShopStock.demandBand,
    createdAt: npcShopStock.createdAt,
  }).from(npcShopStock)
    .innerJoin(cards, eq(cards.id, npcShopStock.cardId))
    .innerJoin(sets, eq(sets.id, cards.setId))
    .where(and(
      eq(npcShopStock.userId, userId),
      inArray(npcShopStock.status, ['available', 'held']),
    )).orderBy(asc(npcShopStock.shopId), asc(npcShopStock.createdAt));

  const latest = await Promise.all(DEALERS.map((dealer) => latestRotation(userId, dealer.id, db)));
  const activity = await db.select({
    id: npcShopStock.id,
    shopId: npcShopStock.shopId,
    status: npcShopStock.status,
    name: cards.name,
    gradeCompany: npcShopStock.gradeCompany,
    numericGrade: npcShopStock.numericGrade,
    resolvedAt: npcShopStock.resolvedAt,
  }).from(npcShopStock)
    .innerJoin(cards, eq(cards.id, npcShopStock.cardId))
    .where(and(
      eq(npcShopStock.userId, userId),
      inArray(npcShopStock.status, ['sold_to_npc', 'purchased']),
      isNotNull(npcShopStock.resolvedAt),
    )).orderBy(desc(npcShopStock.resolvedAt)).limit(8);

  const mappedStock = stock.map((row): NpcStockView => ({
    id: row.id,
    shopId: row.shopId,
    cardId: row.cardId,
    name: row.name,
    number: row.number,
    setName: row.setName,
    rarityTier: row.rarityTier as RarityTier,
    imageSmall: row.imageSmall,
    imageLarge: row.imageLarge,
    condition: row.condition as Condition,
    conditionLabel: CONDITION_LABEL[row.condition as Condition],
    grade: row.gradeCompany && row.numericGrade != null ? {
      company: row.gradeCompany,
      numericGrade: row.numericGrade,
      label: row.gradeLabel ?? '',
      isBlackLabel: row.isBlackLabel,
    } : null,
    marketValue: cents(row.marketValue),
    askPrice: cents(row.askPrice),
    priceConfidence: row.priceConfidence,
    demandBand: row.demandBand,
    isNew: now.getTime() - new Date(row.createdAt).getTime() < 20 * 60 * 1_000,
  }));

  return {
    serverTime: now.toISOString(),
    dealers: DEALERS.map((dealer, index) => ({
      ...dealer,
      trafficBp: Number(dealer.trafficBp),
      tradeCreditBp: Number(dealer.tradeCreditBp),
      refreshAt: latest[index] ? new Date(latest[index]!.refreshAt).toISOString() : now.toISOString(),
      stock: mappedStock.filter((item) => item.shopId === dealer.id),
      emptySlots: Math.max(0, STOCK_SIZE - mappedStock.filter((item) => item.shopId === dealer.id).length),
    })),
    activity: activity.map((row) => ({
      ...row,
      resolvedAt: row.resolvedAt ? new Date(row.resolvedAt).toISOString() : null,
    })),
  };
}

async function criteriaForStock(stockId: string, database: DbLike): Promise<WantedCriteria> {
  const [row] = await database.select({ criteria: npcShopRotations.wantedCriteria })
    .from(npcShopStock)
    .innerJoin(npcShopRotations, eq(npcShopRotations.id, npcShopStock.rotationId))
    .where(eq(npcShopStock.id, stockId)).limit(1);
  if (!row) throw new GameError('That card is no longer in the dealer case', 'stock_unavailable');
  return row.criteria as WantedCriteria;
}

async function eligibleTrades(
  userId: string,
  stockId: string,
  profile: DealerProfile,
  database: DbLike,
): Promise<TradeCardView[]> {
  const criteria = await criteriaForStock(stockId, database);
  const rows = await database.select({
    inventoryId: inventoryItems.id,
    cardId: cards.id,
    name: cards.name,
    setName: sets.name,
    era: sets.era,
    rarityTier: cards.rarityTier,
    imageSmall: cards.imageSmall,
    basePrice: sql<number>`coalesce(${marketState.currentPrice}, ${cards.marketBasePrice}, 0)::int`,
    condition: inventoryItems.condition,
    favorite: inventoryItems.favorite,
    gradeCompany: grades.gradeCompany,
    numericGrade: grades.numericGrade,
    gradeLabel: grades.label,
  }).from(inventoryItems)
    .innerJoin(cards, eq(cards.id, inventoryItems.cardId))
    .innerJoin(sets, eq(sets.id, cards.setId))
    .leftJoin(marketState, eq(marketState.cardId, cards.id))
    .leftJoin(grades, and(eq(grades.inventoryItemId, inventoryItems.id), eq(grades.status, 'completed')))
    .where(and(
      eq(inventoryItems.userId, userId),
      eq(inventoryItems.status, 'owned'),
    )).orderBy(desc(sql`coalesce(${marketState.currentPrice}, ${cards.marketBasePrice}, 0)`));

  interface EligibleRow {
    inventoryId: string; cardId: string; name: string; setName: string; era: string;
    rarityTier: string; imageSmall: string | null; basePrice: number;
    condition: string | null; favorite: boolean; gradeCompany: string | null;
    numericGrade: number | null; gradeLabel: string | null;
  }
  const typedRows = rows as EligibleRow[];
  const wanted = typedRows.filter((row) => row.basePrice > 0 && (
    criteria.exactCardIds.includes(row.cardId)
    || criteria.eras.includes(row.era)
    || criteria.rarityTiers.includes(row.rarityTier)
    || (criteria.wantsGraded && row.numericGrade != null)
  ));

  return wanted.slice(0, 80).map((row) => {
    const condition = (row.condition ?? 'near_mint') as Condition;
    const grade = row.gradeCompany && row.numericGrade != null ? {
      company: row.gradeCompany,
      numericGrade: row.numericGrade,
      label: row.gradeLabel ?? '',
      isBlackLabel: (row.gradeLabel ?? '').includes('Black Label'),
    } : null;
    const marketValue = effectiveValue(cents(row.basePrice), condition, {
      company: grade?.company ?? null,
      numericGrade: grade?.numericGrade ?? null,
      label: grade?.label ?? null,
      isBlackLabel: grade?.isBlackLabel,
    });
    const exactWishlist = criteria.exactCardIds.includes(row.cardId);
    return {
      inventoryId: row.inventoryId,
      cardId: row.cardId,
      name: row.name,
      setName: row.setName,
      imageSmall: row.imageSmall,
      condition,
      grade,
      marketValue,
      credit: tradeCredit(marketValue, profile.tradeCreditBp, exactWishlist),
      exactWishlist,
      favorite: row.favorite,
    };
  });
}

async function requireStock(userId: string, stockId: string, database: DbLike) {
  const [stock] = await database.select().from(npcShopStock).where(and(
    eq(npcShopStock.id, stockId),
    eq(npcShopStock.userId, userId),
  )).for('update').limit(1);
  if (!stock || !['available', 'held'].includes(stock.status)) {
    throw new GameError('Another collector already took that card', 'stock_unavailable');
  }
  return stock;
}

export async function openNegotiation(userId: string, stockId: string, database?: Database) {
  const db = database ?? await getDb();
  const now = new Date();
  await settleElapsedStock(userId, now, db);
  const stock = await requireStock(userId, stockId, db);
  if (stock.status === 'held' && stock.holdUserId !== userId && stock.holdUntil && new Date(stock.holdUntil) > now) {
    throw new GameError('That card is being discussed at the counter', 'stock_held');
  }

  let [negotiation] = await db.select().from(npcNegotiations).where(and(
    eq(npcNegotiations.userId, userId),
    eq(npcNegotiations.stockId, stockId),
    eq(npcNegotiations.status, 'active'),
  )).limit(1);
  if (!negotiation) {
    [negotiation] = await db.insert(npcNegotiations).values({
      id: randomUUID(), userId, stockId, counterPrice: stock.askPrice, createdAt: now, updatedAt: now,
    }).returning();
  }
  const holdUntil = datePlus(now, HOLD_MS);
  await db.update(npcShopStock).set({
    status: 'held', holdUserId: userId, holdUntil,
  }).where(eq(npcShopStock.id, stockId));

  const dealer = dealerById(stock.shopId);
  return {
    negotiation: {
      id: negotiation!.id,
      stockId,
      anger: negotiation!.anger,
      attempts: negotiation!.attempts,
      counterPrice: cents(negotiation!.counterPrice),
      lastOffer: negotiation!.lastOffer == null ? null : cents(negotiation!.lastOffer),
      holdUntil: holdUntil.toISOString(),
    },
    trades: await eligibleTrades(userId, stockId, dealer, db),
  };
}

function selectedTradeRows(all: TradeCardView[], ids: readonly string[]): TradeCardView[] {
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length || unique.length > 12) {
    throw new GameError('Select no more than 12 different trade cards', 'bad_trade_selection');
  }
  const byId = new Map(all.map((item) => [item.inventoryId, item]));
  const selected = unique.map((id) => byId.get(id));
  if (selected.some((item) => !item)) {
    throw new GameError('One of those cards is no longer available or wanted', 'trade_unavailable');
  }
  return selected as TradeCardView[];
}

async function settlePurchaseTx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  userId: string,
  stock: typeof npcShopStock.$inferSelect,
  negotiationId: string | null,
  acceptedTotal: Cents,
  selected: TradeCardView[],
  now: Date,
) {
  const tradeTotal = cents(selected.reduce((sum, item) => sum + item.credit, 0));
  if (tradeTotal >= acceptedTotal) {
    throw new GameError('Trade credit must leave at least $0.01 to pay', 'trade_too_large');
  }
  const cashDue = cents(acceptedTotal - tradeTotal);
  const purchaseInventoryId = randomUUID();
  const gradeId = stock.gradeCompany && stock.numericGrade != null ? randomUUID() : null;

  if (selected.length > 0) {
    const lockedTrades = await tx.select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(and(
        eq(inventoryItems.userId, userId),
        eq(inventoryItems.status, 'owned'),
        inArray(inventoryItems.id, selected.map((item) => item.inventoryId)),
      )).for('update');
    if (lockedTrades.length !== selected.length) {
      throw new GameError('One of those trade cards is no longer available', 'trade_unavailable');
    }
    await tx.update(inventoryItems).set({ status: 'traded' })
      .where(and(
        eq(inventoryItems.userId, userId),
        eq(inventoryItems.status, 'owned'),
        inArray(inventoryItems.id, selected.map((item) => item.inventoryId)),
      ));
  }

  await tx.insert(inventoryItems).values({
    id: purchaseInventoryId,
    userId,
    type: 'card',
    cardId: stock.cardId,
    quantity: 1,
    condition: stock.condition,
    acquisitionSource: 'npc_market_purchase',
    acquisitionPrice: cashDue,
    status: 'owned',
    gradingId: gradeId,
    acquiredAt: now,
  });

  if (gradeId && stock.gradeCompany && stock.numericGrade != null) {
    await tx.insert(grades).values({
      id: gradeId,
      userId,
      inventoryItemId: purchaseInventoryId,
      gradeCompany: stock.gradeCompany,
      serviceTier: 'npc-market',
      numericGrade: stock.numericGrade,
      label: stock.gradeLabel,
      submissionFee: 0,
      status: 'completed',
      submittedAt: now,
      readyAt: now,
      completedAt: now,
    });
  }

  const ledger = await applyTransactionInTx(tx, {
    userId,
    type: 'card_purchase',
    amount: cents(-cashDue),
    itemType: 'npc_shop_stock',
    itemId: stock.id,
    metadata: {
      via: 'npc_dealer',
      dealerId: stock.shopId,
      cardId: stock.cardId,
      askPrice: stock.askPrice,
      acceptedTotal,
      cashPaid: cashDue,
      tradeInventoryIds: selected.map((item) => item.inventoryId),
      tradeCredits: selected.map((item) => ({ inventoryId: item.inventoryId, credit: item.credit })),
      purchaseInventoryId,
    },
  });

  await tx.update(npcShopStock).set({
    status: 'purchased', resolvedAt: now, holdUserId: null, holdUntil: null,
  }).where(eq(npcShopStock.id, stock.id));
  if (negotiationId) {
    await tx.update(npcNegotiations).set({ status: 'accepted', updatedAt: now })
      .where(eq(npcNegotiations.id, negotiationId));
  }
  return {
    purchased: true as const,
    inventoryId: purchaseInventoryId,
    cardId: stock.cardId,
    cashPaid: cashDue,
    tradeCredit: tradeTotal,
    acceptedTotal,
    balanceAfter: ledger.balanceAfter,
  };
}

export async function makeOffer(
  userId: string,
  input: { stockId: string; negotiationId: string; totalOffer: Cents; tradeInventoryIds: string[] },
  database?: Database,
) {
  const db = database ?? await getDb();
  const now = new Date();
  if (!Number.isInteger(input.totalOffer) || input.totalOffer < 1) {
    throw new GameError('Choose a valid offer', 'bad_offer');
  }
  await settleElapsedStock(userId, now, db);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await db.transaction(async (tx: any) => {
      const [joined] = await tx.select({
        stock: npcShopStock,
        negotiation: npcNegotiations,
      }).from(npcNegotiations)
        .innerJoin(npcShopStock, eq(npcShopStock.id, npcNegotiations.stockId))
        .where(and(
          eq(npcNegotiations.id, input.negotiationId),
          eq(npcNegotiations.userId, userId),
          eq(npcNegotiations.stockId, input.stockId),
          eq(npcNegotiations.status, 'active'),
        )).for('update').limit(1);
      if (!joined || joined.stock.status !== 'held' || joined.stock.holdUserId !== userId
        || !joined.stock.holdUntil || new Date(joined.stock.holdUntil) <= now) {
        throw new GameError('Your hold expired; check whether the card is still available', 'hold_expired');
      }

      const dealer = dealerById(joined.stock.shopId);
      const allTrades = await eligibleTrades(userId, joined.stock.id, dealer, tx);
      const selected = selectedTradeRows(allTrades, input.tradeInventoryIds);
      const offered = cents(Math.min(input.totalOffer, joined.negotiation.counterPrice));
      const result = resolveNpcOffer({
        totalOffer: offered,
        counterPrice: cents(joined.negotiation.counterPrice),
        sellerFloor: cents(joined.stock.sellerFloor),
        anger: joined.negotiation.anger,
        attempts: joined.negotiation.attempts,
        lastOffer: joined.negotiation.lastOffer == null ? null : cents(joined.negotiation.lastOffer),
        temperamentBase: dealer.temperamentBase,
        repetitionPenalty: dealer.repetitionPenalty,
      });

      if (result.accepted) {
        return settlePurchaseTx(tx, userId, joined.stock, joined.negotiation.id, result.acceptedTotal, selected, now);
      }

      const status = result.walked ? 'walked' : 'active';
      await tx.update(npcNegotiations).set({
        status,
        anger: result.anger,
        attempts: joined.negotiation.attempts + 1,
        counterPrice: result.counterPrice,
        lastOffer: offered,
        updatedAt: now,
      }).where(eq(npcNegotiations.id, joined.negotiation.id));

      const holdUntil = result.walked ? null : datePlus(now, HOLD_MS);
      await tx.update(npcShopStock).set(result.walked ? {
        status: 'walked', resolvedAt: now, holdUserId: null, holdUntil: null,
      } : { holdUntil }).where(eq(npcShopStock.id, joined.stock.id));

      return {
        purchased: false as const,
        walked: result.walked,
        anger: result.anger,
        angerDelta: result.angerDelta,
        counterPrice: result.counterPrice,
        risk: offerRisk(offered, result.counterPrice, result.anger),
        holdUntil: holdUntil?.toISOString() ?? null,
      };
    });
  } catch (error) {
    if (error instanceof InsufficientFundsError) {
      throw new GameError('You do not have enough cash for the rest of this deal', 'insufficient_funds');
    }
    throw error;
  }
}

export async function buyNow(
  userId: string,
  stockId: string,
  tradeInventoryIds: string[],
  database?: Database,
) {
  const db = database ?? await getDb();
  const now = new Date();
  await settleElapsedStock(userId, now, db);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await db.transaction(async (tx: any) => {
      const stock = await requireStock(userId, stockId, tx);
      const dealer = dealerById(stock.shopId);
      const selected = selectedTradeRows(
        await eligibleTrades(userId, stock.id, dealer, tx),
        tradeInventoryIds,
      );
      const [activeNegotiation] = await tx.select({ id: npcNegotiations.id })
        .from(npcNegotiations)
        .where(and(
          eq(npcNegotiations.userId, userId),
          eq(npcNegotiations.stockId, stock.id),
          eq(npcNegotiations.status, 'active'),
        )).limit(1);
      return settlePurchaseTx(
        tx, userId, stock, activeNegotiation?.id ?? null, cents(stock.askPrice), selected, now,
      );
    });
  } catch (error) {
    if (error instanceof InsufficientFundsError) {
      throw new GameError('You do not have enough cash for the rest of this deal', 'insufficient_funds');
    }
    throw error;
  }
}

export async function releaseNegotiation(
  userId: string,
  stockId: string,
  negotiationId: string,
  database?: Database,
) {
  const db = database ?? await getDb();
  const now = new Date();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.transaction(async (tx: any) => {
    await tx.update(npcNegotiations).set({ status: 'abandoned', updatedAt: now }).where(and(
      eq(npcNegotiations.id, negotiationId),
      eq(npcNegotiations.userId, userId),
      eq(npcNegotiations.stockId, stockId),
      eq(npcNegotiations.status, 'active'),
    ));
    await tx.update(npcShopStock).set({ status: 'available', holdUserId: null, holdUntil: null })
      .where(and(
        eq(npcShopStock.id, stockId),
        eq(npcShopStock.userId, userId),
        eq(npcShopStock.status, 'held'),
        eq(npcShopStock.holdUserId, userId),
      ));
  });
  return { released: true };
}
