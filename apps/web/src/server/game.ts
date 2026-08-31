import { randomUUID } from 'node:crypto';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { getDb } from '@pcs/db';
import {
  sets, cards, openings, openingCards, inventoryItems, packTemplates, pullTables, grades,
} from '@pcs/db/schema';
import { cents, type Cents, type RarityTier } from '@pcs/shared';
import {
  openPack as simulatePack, deriveTemplate, isReverseEligible, createSeed,
  expectedPackValue, type EngineCard,
} from '@pcs/pack-engine';
import {
  applyTransaction, InsufficientFundsError, dealerBuyOffer, derivePackPrice,
  computePrice, rollPackCondition, mulberry32, gradedValue,
} from '@pcs/economy-engine';
import { grantXp } from './progression-service';

/**
 * The game service. Every economically meaningful decision happens here, on
 * the server (DESIGN.md section 22).
 *
 * The client may say "open the pack I own"; it may never say what was in it.
 */

export class GameError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'GameError';
  }
}

/** Load a set's cards in the shape the pack engine wants. */
async function loadEngineSet(setId: string) {
  const db = await getDb();
  const [set] = await db.select().from(sets).where(eq(sets.id, setId)).limit(1);
  if (!set) throw new GameError(`No such set: ${setId}`, 'set_not_found');

  const rows = await db
    .select({
      id: cards.id, number: cards.number, rarityTier: cards.rarityTier,
      price: cards.marketBasePrice,
    })
    .from(cards)
    .where(eq(cards.setId, setId));

  if (rows.length === 0) throw new GameError(`Set ${setId} has no cards`, 'set_empty');

  const engineCards: EngineCard[] = rows.map((r) => ({
    id: r.id, setId, number: r.number,
    rarityTier: r.rarityTier as RarityTier,
    reverseEligible: isReverseEligible(set.era, r.rarityTier as RarityTier),
  }));

  const prices = new Map(rows.map((r) => [r.id, r.price]));
  return { set, engineCards, prices };
}

/**
 * What a pack of this set costs.
 *
 * Derived from the average value of the set's cards rather than from a
 * historical MSRP, because a 1999 pack priced at its 1999 price would be an
 * infinite money glitch against 2026 card values. See derivePackPrice.
 */
/**
 * Expected contents value of one pack of this set, weighted by the actual slot
 * structure rather than by the mean card price.
 *
 * The mean is badly wrong here: a set's average card price is dragged upward
 * by a handful of chase cards that a pack almost never contains. Pricing packs
 * off the mean made them cost roughly four times what they returned — three
 * 151 packs cost $79.80 and yielded about $20 of cards. Opening should be
 * unprofitable on average (DESIGN.md section 30), but by a house edge, not by
 * 300%.
 *
 * So each slot is valued at the average price of the rarities it can actually
 * produce, weighted by that slot's real odds.
 */
async function expectedContentsValue(setId: string): Promise<Cents> {
  const { set, engineCards, prices } = await loadEngineSet(setId);
  const { template, tables } = deriveTemplate(set, engineCards);
  const value = expectedPackValue(
    template,
    tables,
    engineCards,
    (cardId) => prices.get(cardId) ?? 0,
  );
  return cents(Math.round(value));
}

/**
 * What a pack costs to buy.
 *
 * Derived from expected contents plus a house edge, never from historical
 * MSRP: a 1999 pack sold at its 1999 price against 2026 card values would be
 * an infinite money glitch.
 */
export async function getPackPrice(setId: string): Promise<Cents> {
  const db = await getDb();

  // Prefer the simulated price written by scripts/simulate/price-packs.ts. It
  // is measured by running the real engine, so it accounts for the
  // no-duplicate rule that the closed-form estimate cannot.
  const [stored] = await db
    .select({ price: packTemplates.simulatorPrice })
    .from(packTemplates)
    .where(eq(packTemplates.id, `${setId}-booster`))
    .limit(1);

  if (stored?.price && stored.price > 0) return cents(stored.price);

  // No cached price yet: fall back to the analytic estimate so a newly
  // imported set is still playable before the pricing job has run.
  return derivePackPrice(await expectedContentsValue(setId));
}

/** Exposed for the balance harness. */
export { expectedContentsValue };

/**
 * Persist a derived template and its tables so openings can reference them.
 *
 * Templates are versioned data, not code (DESIGN.md section 24): an opening
 * records which template version produced it, so changing pull rates later
 * cannot silently rewrite the meaning of past results. Derivation is
 * deterministic, so this upserts rather than duplicating.
 */
async function ensureTemplatePersisted(
  template: ReturnType<typeof deriveTemplate>['template'],
  tables: ReturnType<typeof deriveTemplate>['tables'],
  simulatorPrice: Cents,
): Promise<void> {
  const db = await getDb();

  await db.insert(packTemplates).values({
    id: template.id,
    setId: template.setId,
    name: template.name,
    productType: template.productType,
    cardsPerPack: template.cardsPerPack,
    slots: template.slots,
    simulatorPrice,
    confidence: template.confidence,
    source: template.source,
    version: template.version,
  }).onConflictDoUpdate({
    target: packTemplates.id,
    set: {
      slots: template.slots,
      cardsPerPack: template.cardsPerPack,
      simulatorPrice,
      confidence: template.confidence,
      source: template.source,
      version: template.version,
    },
  });

  for (const t of tables) {
    await db.insert(pullTables).values({
      id: t.id,
      setId: template.setId,
      name: t.name,
      selectionMode: t.selectionMode,
      entries: t.entries,
      rarityWeights: t.rarityWeights ?? null,
      confidence: t.confidence,
      source: t.source,
      version: t.version,
    }).onConflictDoUpdate({
      target: pullTables.id,
      set: {
        entries: t.entries,
        rarityWeights: t.rarityWeights ?? null,
        confidence: t.confidence,
        source: t.source,
        version: t.version,
      },
    });
  }
}

export interface OpenedCard {
  cardId: string;
  name: string;
  number: string;
  rarityTier: RarityTier;
  imageSmall: string | null;
  imageLarge: string | null;
  slotName: string;
  isHit: boolean;
  isReverse: boolean;
  condition: string;
  value: Cents;
  inventoryId: string;
}

export interface OpenPackResult {
  openingId: string;
  setId: string;
  setName: string;
  cost: Cents;
  balanceAfter: Cents;
  totalValue: Cents;
  seedHash: string;
  confidence: string;
  cards: OpenedCard[];
}

/**
 * Buy and open one pack, atomically.
 *
 * The seed is generated here with node:crypto and never leaves the server; only
 * its hash is stored, so a past opening can be audited but a future one cannot
 * be predicted.
 */
export async function buyAndOpenPack(userId: string, setId: string): Promise<OpenPackResult> {
  const db = await getDb();
  const { set, engineCards, prices } = await loadEngineSet(setId);
  const { template, tables } = deriveTemplate(set, engineCards);

  const cost = await getPackPrice(setId);
  await ensureTemplatePersisted(template, tables, cost);

  // Charge first. If this throws, nothing else has happened yet.
  let balanceAfter: Cents;
  try {
    const res = await applyTransaction(db as never, {
      userId,
      type: 'pack_purchase',
      amount: cents(-cost),
      itemType: 'pack_template',
      itemId: template.id,
      metadata: { setId, templateVersion: template.version },
    });
    balanceAfter = res.balanceAfter;
  } catch (err) {
    if (err instanceof InsufficientFundsError) {
      throw new GameError('Not enough cash for this pack', 'insufficient_funds');
    }
    throw err;
  }

  const seed = createSeed();
  const result = simulatePack({ template, tables, cards: engineCards, seed });

  const openingId = randomUUID();
  const rng = mulberry32(Math.floor(Math.random() * 2 ** 31));

  const meta = new Map(
    (
      await db
        .select({
          id: cards.id, name: cards.name, number: cards.number,
          imageSmall: cards.imageSmall, imageLarge: cards.imageLarge,
        })
        .from(cards)
        .where(inArray(cards.id, result.cards.map((c) => c.cardId)))
    ).map((r) => [r.id, r]),
  );

  const opened: OpenedCard[] = [];
  let totalValue = 0;

  // Which of these cards the player already had, read BEFORE the pack is
  // written. Reading it afterwards would count every card as already owned,
  // because the pack itself has just inserted them.
  const pulledIds = new Set(result.cards.map((c) => c.cardId));
  const ownedBefore = new Set(
    (
      await db
        .select({ cardId: inventoryItems.cardId })
        .from(inventoryItems)
        .where(
          and(
            eq(inventoryItems.userId, userId),
            inArray(inventoryItems.cardId, [...pulledIds]),
          ),
        )
    ).map((r) => r.cardId as string),
  );

  await db.transaction(async (tx: any) => {
    await tx.insert(openings).values({
      id: openingId,
      userId,
      packTemplateId: template.id,
      templateVersion: template.version,
      cost,
      rngSeedHash: result.seedHash,
      totalValue: 0,
    });

    for (const pulled of result.cards) {
      const m = meta.get(pulled.cardId);
      const condition = rollPackCondition(rng);
      const base = prices.get(pulled.cardId) ?? 0;
      const value = computePrice(cents(base), { condition });
      totalValue += value;

      const inventoryId = randomUUID();
      await tx.insert(inventoryItems).values({
        id: inventoryId,
        userId,
        type: 'card',
        cardId: pulled.cardId,
        quantity: 1,
        condition,
        acquisitionSource: 'pack',
        acquisitionPrice: cents(0),
        status: 'owned',
      });

      await tx.insert(openingCards).values({
        id: randomUUID(),
        openingId,
        cardId: pulled.cardId,
        inventoryItemId: inventoryId,
        slotName: pulled.slotName,
        slotIndex: pulled.slotIndex,
        valueAtPull: value,
      });

      opened.push({
        cardId: pulled.cardId,
        name: m?.name ?? pulled.cardId,
        number: m?.number ?? '',
        rarityTier: pulled.rarityTier,
        imageSmall: m?.imageSmall ?? null,
        imageLarge: m?.imageLarge ?? null,
        slotName: pulled.slotName,
        isHit: pulled.isHit,
        isReverse: pulled.isReverse,
        condition,
        value,
        inventoryId,
      });
    }

    await tx.update(openings).set({ totalValue: cents(totalValue) }).where(eq(openings.id, openingId));
  });

  // XP is awarded after the opening is committed, so a failed write cannot
  // leave a player levelled up for a pack they never received.
  const firstTime = [...pulledIds].filter((id) => !ownedBefore.has(id)).length;

  await grantXp(userId, 'pack_opened');
  if (firstTime > 0) await grantXp(userId, 'new_card', firstTime);
  const hits = opened.filter((c) => c.isHit).length;
  if (hits > 0) await grantXp(userId, 'hit_pulled', hits);

  return {
    openingId,
    setId,
    setName: set.name,
    cost,
    balanceAfter,
    totalValue: cents(totalValue),
    seedHash: result.seedHash,
    confidence: template.confidence,
    cards: opened,
  };
}

/** Sell one owned card to the NPC dealer at the buylist spread. */
export async function sellCard(userId: string, inventoryId: string) {
  const db = await getDb();

  const [item] = await db
    .select({
      id: inventoryItems.id, cardId: inventoryItems.cardId,
      status: inventoryItems.status, condition: inventoryItems.condition,
      basePrice: cards.marketBasePrice, name: cards.name,
      gradeCompany: grades.gradeCompany,
      numericGrade: grades.numericGrade,
      gradeLabel: grades.label,
      gradeStatus: grades.status,
    })
    .from(inventoryItems)
    .leftJoin(cards, eq(cards.id, inventoryItems.cardId))
    // A card may have been graded. Only a collected grade counts: one still in
    // the queue has not been returned to the player.
    .leftJoin(
      grades,
      and(eq(grades.inventoryItemId, inventoryItems.id), eq(grades.status, 'completed')),
    )
    .where(and(eq(inventoryItems.id, inventoryId), eq(inventoryItems.userId, userId)))
    .limit(1);

  if (!item) throw new GameError('You do not own that card', 'not_owned');
  if (item.status !== 'owned') throw new GameError('That card is not available to sell', 'not_sellable');

  const raw = computePrice(cents(item.basePrice ?? 0), {
    condition: (item.condition ?? 'near_mint') as never,
  });

  // A graded card sells at its graded value, not its raw value. Without this
  // the grading fee bought nothing and the whole system was a money sink with
  // no upside.
  const isGraded = item.numericGrade != null && item.gradeStatus === 'completed';
  const market = isGraded
    ? gradedValue(raw, {
        company: item.gradeCompany as never,
        numericGrade: item.numericGrade!,
        label: item.gradeLabel ?? '',
        isBlackLabel: (item.gradeLabel ?? '').includes('Black Label'),
      })
    : raw;

  const offer = dealerBuyOffer(market);

  await db.update(inventoryItems).set({ status: 'sold' }).where(eq(inventoryItems.id, inventoryId));

  const { balanceAfter } = await applyTransaction(db as never, {
    userId,
    type: 'card_sale',
    amount: offer,
    itemType: 'card',
    itemId: item.cardId ?? undefined,
    metadata: {
      inventoryId,
      marketValue: market,
      rawValue: raw,
      name: item.name,
      graded: isGraded ? `${item.gradeCompany} ${item.numericGrade}` : null,
    },
  });

  await grantXp(userId, 'card_sold');

  return {
    sold: item.name ?? '',
    marketValue: market,
    rawValue: raw,
    graded: isGraded ? `${item.gradeCompany} ${item.numericGrade}` : null,
    offer,
    balanceAfter,
  };
}
