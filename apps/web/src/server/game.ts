import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
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
  applyTransaction, applyRepeatedTransactionInTx, dealerBuyOffer,
  derivePackPrice, computePrice, rollPackCondition, mulberry32, gradedValue,
} from '@pcs/economy-engine';
import { grantXp, grantXpMany } from './progression-service';

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
      price: cards.marketBasePrice, name: cards.name,
      imageSmall: cards.imageSmall, imageLarge: cards.imageLarge,
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
  // The display metadata comes back with the pool rather than in a second
  // query keyed on what was pulled: the pool is already in memory, and a
  // fifty-pack rip would otherwise issue that lookup fifty times.
  const meta = new Map(rows.map((r) => [r.id, r]));
  return { set, engineCards, prices, meta };
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
  return expectedValueOf(template, tables, engineCards, prices);
}

/** The same figure, for a caller that has already loaded the set. */
function expectedValueOf(
  template: ReturnType<typeof deriveTemplate>['template'],
  tables: ReturnType<typeof deriveTemplate>['tables'],
  engineCards: readonly EngineCard[],
  prices: Map<string, number | null>,
): Cents {
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
  const stored = await getStoredPackPrice(setId);

  if (stored !== null) return stored;

  // No cached price yet: fall back to the analytic estimate so a newly
  // imported set is still playable before the pricing job has run.
  return derivePackPrice(await expectedContentsValue(setId));
}

/**
 * Price-pack import writes these rows ahead of time. Keeping this lookup
 * separate lets the opening path avoid re-writing immutable template data for
 * every purchase.
 */
async function getStoredPackPrice(setId: string): Promise<Cents | null> {
  const db = await getDb();
  const [stored] = await db
    .select({
      marketPrice: packTemplates.marketBasePrice,
      simulatorPrice: packTemplates.simulatorPrice,
    })
    .from(packTemplates)
    .where(eq(packTemplates.id, `${setId}-booster`))
    .limit(1);
  if (!stored) return null;
  // What the sealed pack really trades for comes first; the contents-derived
  // figure is the fallback for sets no market covers.
  const price = stored.marketPrice && stored.marketPrice > 0
    ? stored.marketPrice
    : stored.simulatorPrice;
  return price > 0 ? cents(price) : null;
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
  isNew: boolean;
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
 * Buy and open packs of one set, atomically.
 *
 * The seed is generated here with node:crypto and never leaves the server; only
 * its hash is stored, so a past opening can be audited but a future one cannot
 * be predicted.
 *
 * A rip of fifty packs is fifty purchases and fifty ledger rows, but it is one
 * read of the set, one derived template, one balance lock and one write. The
 * previous shape re-read the whole card pool and re-derived the template once
 * per pack, which is why ten was the practical ceiling.
 *
 * How many packs the player can afford is decided inside the transaction,
 * under the same lock that spends the money — so a batch either opens `count`
 * packs or opens the largest affordable prefix, and never charges for a pack
 * it did not deal.
 */
export async function buyAndOpenPacks(
  userId: string,
  setId: string,
  count: number,
): Promise<OpenPackResult[]> {
  if (count < 1) return [];

  const db = await getDb();
  const { set, engineCards, prices, meta } = await loadEngineSet(setId);
  const { template, tables } = deriveTemplate(set, engineCards);

  // Templates and their prices are imported once, not regenerated on every
  // click. The fallback keeps a freshly imported catalogue playable before
  // `data:price-packs` has run.
  const storedPrice = await getStoredPackPrice(setId);
  const cost = storedPrice ?? derivePackPrice(expectedValueOf(template, tables, engineCards, prices));
  if (storedPrice === null) await ensureTemplatePersisted(template, tables, cost);

  // Which of this set's cards the player already holds, read once for the
  // whole batch. Cards gained earlier in the same batch are tracked in memory
  // below, so the album sticker still lands on exactly the first copy.
  const ownedRows = await db
    .select({ cardId: inventoryItems.cardId })
    .from(inventoryItems)
    .innerJoin(cards, eq(cards.id, inventoryItems.cardId))
    .where(
      and(
        eq(inventoryItems.userId, userId),
        eq(cards.setId, setId),
        eq(inventoryItems.status, 'owned'),
      ),
    );
  const seen = new Set(ownedRows.map((r) => r.cardId as string));

  const rng = mulberry32(Math.floor(Math.random() * 2 ** 31));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = await db.transaction(async (tx: any) => {
    // Charge first, and let the ledger decide how many of the requested packs
    // the balance covers. It reads and locks the row once to answer that, so
    // nothing here needs its own view of the money. Simulation and the writes
    // below share this transaction: if any of them throws, the charges roll
    // back with them.
    const charges = await applyRepeatedTransactionInTx(
      tx,
      userId,
      {
        type: 'pack_purchase',
        amount: cents(-cost),
        itemType: 'pack_template',
        itemId: template.id,
        metadata: { setId, templateVersion: template.version },
      },
      count,
    );
    const dealing = charges.length;
    if (dealing < 1) throw new GameError('Not enough cash for this pack', 'insufficient_funds');

    const openingRows: (typeof openings.$inferInsert)[] = [];
    const inventoryRows: (typeof inventoryItems.$inferInsert)[] = [];
    const openingCardRows: (typeof openingCards.$inferInsert)[] = [];
    const perPack: { openingId: string; seedHash: string; totalValue: number; cards: OpenedCard[] }[] = [];

    for (let i = 0; i < dealing; i++) {
      const seed = createSeed();
      const result = simulatePack({ template, tables, cards: engineCards, seed });
      const openingId = randomUUID();
      const opened: OpenedCard[] = [];
      let totalValue = 0;

      for (const pulled of result.cards) {
        const m = meta.get(pulled.cardId);
        const condition = rollPackCondition(rng);
        const base = prices.get(pulled.cardId) ?? 0;
        const value = computePrice(cents(base), { condition });
        totalValue += value;

        const inventoryId = randomUUID();
        // The same card can occupy two slots, in one pack or across the
        // batch. Only the first copy advances the album, so only it earns
        // the sticker.
        const isNew = !seen.has(pulled.cardId);
        seen.add(pulled.cardId);

        inventoryRows.push({
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
        openingCardRows.push({
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
          isNew,
          condition,
          value,
          inventoryId,
        });
      }

      openingRows.push({
        id: openingId,
        userId,
        packTemplateId: template.id,
        templateVersion: template.version,
        cost,
        rngSeedHash: result.seedHash,
        totalValue: cents(totalValue),
      });
      perPack.push({ openingId, seedHash: result.seedHash, totalValue, cards: opened });
    }

    await tx.insert(openings).values(openingRows);
    await tx.insert(inventoryItems).values(inventoryRows);
    await tx.insert(openingCards).values(openingCardRows);

    return perPack.map((pack, i) => ({
      openingId: pack.openingId,
      setId,
      setName: set.name,
      cost,
      balanceAfter: charges[i]!.balanceAfter,
      totalValue: cents(pack.totalValue),
      seedHash: pack.seedHash,
      confidence: template.confidence,
      cards: pack.cards,
    } satisfies OpenPackResult));
  });

  // XP is awarded after the openings are committed, so a failed write cannot
  // leave a player levelled up for packs they never received.
  const newCards = results.reduce((n, r) => n + r.cards.filter((c) => c.isNew).length, 0);
  const hits = results.reduce((n, r) => n + r.cards.filter((c) => c.isHit).length, 0);
  await grantXpMany(userId, [
    { reason: 'pack_opened', count: results.length },
    { reason: 'new_card', count: newCards },
    { reason: 'hit_pulled', count: hits },
  ]);

  return results;
}

/** Buy and open a single pack. */
export async function buyAndOpenPack(userId: string, setId: string): Promise<OpenPackResult> {
  const [result] = await buyAndOpenPacks(userId, setId, 1);
  if (!result) throw new GameError('Not enough cash for this pack', 'insufficient_funds');
  return result;
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
