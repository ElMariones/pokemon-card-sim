import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getMemoryDb, type Database } from "@pcs/db";
import {
  cards,
  npcNegotiations,
  npcShopRotations,
  npcShopStock,
  sets,
  users,
} from "@pcs/db/schema";
import { cents } from "@pcs/shared";
import { buyNow } from "../apps/web/src/server/npc-market-service";
import { GameError } from "../apps/web/src/server/game";

const USER = "player";
const STOCK = "stock-1";
const STICKER = cents(1_164);
const FLOOR = cents(900);
const COUNTER = cents(1_013);

/**
 * The dealer's asking price is the counter once haggling has started, so these
 * cover the one number the player actually pays.
 */
async function seed(db: Database, counterPrice: number | null) {
  const now = new Date();
  const later = new Date(now.getTime() + 60 * 60 * 1_000);
  await db.insert(users).values({ id: USER, cash: 100_000 });
  await db.insert(sets).values({ id: "set-a", name: "Test Set", series: "Test", era: "sv", releaseDate: "2024/01/01", source: "test", printedTotal: 1, total: 1 });
  await db.insert(cards).values({
    id: "card-a",
    setId: "set-a",
    name: "Cinccino",
    number: "1",
    rarityRaw: "Rare",
    rarityTier: "rare",
    source: "test",
  });
  await db.insert(npcShopRotations).values({
    id: "rotation-1",
    userId: USER,
    shopId: "mina-modern",
    rotationNumber: 1,
    wantedCriteria: { eras: [], rarityTiers: [], wantsGraded: false, exactCardIds: [] },
    startedAt: now,
    refreshAt: later,
  });
  await db.insert(npcShopStock).values({
    id: STOCK,
    rotationId: "rotation-1",
    userId: USER,
    shopId: "mina-modern",
    slot: 0,
    cardId: "card-a",
    condition: "near_mint",
    marketValue: cents(1_000),
    askPrice: STICKER,
    sellerFloor: FLOOR,
    demandBand: "quiet",
    otherBuyerAt: later,
    status: "held",
    holdUserId: USER,
    holdUntil: later,
    createdAt: now,
  });
  if (counterPrice !== null) {
    await db.insert(npcNegotiations).values({
      id: "negotiation-1",
      userId: USER,
      stockId: STOCK,
      status: "active",
      anger: 30,
      attempts: 1,
      counterPrice,
      lastOffer: cents(700),
      createdAt: now,
      updatedAt: now,
    });
  }
}

async function freshDb(): Promise<Database> {
  const db = await getMemoryDb();
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await migrate(db as any, { migrationsFolder: "./packages/db/migrations" });
  return db;
}

describe("buying from an NPC dealer", () => {
  let db: Database;

  beforeEach(async () => {
    db = await freshDb();
  });

  it("charges the dealer's counter once they have come down from the sticker", async () => {
    await seed(db, COUNTER);

    const result = await buyNow(USER, STOCK, [], db);

    expect(result.acceptedTotal).toBe(COUNTER);
    expect(result.cashPaid).toBe(COUNTER);
    expect(result.balanceAfter).toBe(100_000 - COUNTER);
  });

  it("charges the sticker when no negotiation is open", async () => {
    await seed(db, null);

    const result = await buyNow(USER, STOCK, [], db);

    expect(result.acceptedTotal).toBe(STICKER);
    expect(result.balanceAfter).toBe(100_000 - STICKER);
  });

  it("never charges more than the sticker if a counter somehow exceeds it", async () => {
    await seed(db, STICKER + 500);

    const result = await buyNow(USER, STOCK, [], db);

    expect(result.acceptedTotal).toBe(STICKER);
  });

  it("refuses to charge a price the player was not shown", async () => {
    await seed(db, COUNTER);

    await expect(buyNow(USER, STOCK, [], db, STICKER)).rejects.toThrow(GameError);

    const [user] = await db.select({ cash: users.cash }).from(users).where(eq(users.id, USER));
    expect(user!.cash).toBe(100_000);
    const [stock] = await db.select({ status: npcShopStock.status })
      .from(npcShopStock).where(eq(npcShopStock.id, STOCK));
    expect(stock!.status).toBe("held");
  });

  it("closes the negotiation it settled", async () => {
    await seed(db, COUNTER);

    await buyNow(USER, STOCK, [], db);

    const [negotiation] = await db.select({ status: npcNegotiations.status })
      .from(npcNegotiations).where(eq(npcNegotiations.id, "negotiation-1"));
    expect(negotiation!.status).toBe("accepted");
  });
});
