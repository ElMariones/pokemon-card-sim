import { beforeAll, describe, expect, it } from "vitest";
import { getMemoryDb, type Database } from "@pcs/db";
import { getFinanceDashboard } from "../apps/web/src/server/finance-service";

describe("finance dashboard", () => {
  let db: Database;

  beforeAll(async () => {
    db = await getMemoryDb();
    const client = (db as unknown as { $client: { exec(query: string): Promise<unknown> } }).$client;
    await client.exec(`
      create table sets (
        id text primary key,
        name text not null
      );
      create table cards (
        id text primary key,
        set_id text not null,
        name text not null,
        image_small text,
        market_base_price integer
      );
      create table inventory_items (
        id text primary key,
        user_id text not null,
        type text not null,
        card_id text,
        status text not null,
        condition text
      );
      create table grades (
        id text primary key,
        inventory_item_id text not null,
        status text not null,
        grade_company text not null,
        numeric_grade integer,
        label text
      );
      create table listings (
        id text primary key,
        card_id text not null
      );
      create table transactions (
        id text primary key,
        user_id text not null,
        type text not null,
        amount integer not null,
        balance_after integer not null,
        item_type text,
        item_id text,
        metadata jsonb,
        created_at timestamp not null
      );

      insert into sets values ('set-a', 'Base Test');
      insert into cards values
        ('card-a', 'set-a', 'Pikachu', '/pikachu.png', 1000),
        ('card-b', 'set-a', 'Charizard', '/charizard.png', 2000);
      insert into inventory_items values
        ('inventory-a', 'player', 'card', 'card-a', 'owned', 'near_mint'),
        ('inventory-b', 'player', 'card', 'card-b', 'owned', 'near_mint');
      insert into grades values ('grade-b', 'inventory-b', 'completed', 'PSA', 10, 'Gem Mint');
      insert into transactions values
        ('t0', 'player', 'starting_balance', 50000, 50000, null, null, null, now() - interval '10 days'),
        ('t1', 'player', 'pack_purchase', -500, 49500, 'pack_template', 'pack-a', '{"setId":"set-a"}', now() - interval '8 days'),
        ('t2', 'player', 'card_sale', 2000, 51500, 'card', 'card-a', '{"name":"Pikachu"}', now() - interval '5 days'),
        ('t3', 'player', 'mission_reward', 300, 51800, 'mission', 'daily', null, now() - interval '2 days'),
        ('t4', 'player', 'grading_fee', -1000, 50800, 'grading', 'inventory-b', '{"company":"PSA","count":1}', now() - interval '1 day');
    `);
  });

  it("builds honest cash flow, card values, and detailed activity from the ledger", async () => {
    const dashboard = await getFinanceDashboard("player", 50_800, {
      range: "30d",
      direction: "all",
      type: "",
      q: "",
      page: 1,
    }, db);

    expect(dashboard.summary).toMatchObject({
      cash: 50_800,
      income: 2_300,
      expenses: 1_500,
      net: 800,
      transactions: 4,
    });
    expect(dashboard.timeline.mode).toBe("day");
    expect(dashboard.timeline.points.at(-1)?.balance).toBe(50_800);
    expect(dashboard.activity.items.find((row) => row.id === "t2")).toMatchObject({
      label: "Pikachu",
      direction: "income",
    });
    expect(dashboard.biggestSales[0]?.amount).toBe(2_000);
    expect(dashboard.cards.copies).toBe(2);
    expect(dashboard.cards.uniqueCards).toBe(2);
    expect(dashboard.cards.gradedCopies).toBe(1);
    expect(dashboard.cards.totalValue).toBeGreaterThan(3_000);
    expect(dashboard.cards.top[0]?.name).toBe("Charizard");
  });

  it("applies log direction and search filters without changing summary totals", async () => {
    const dashboard = await getFinanceDashboard("player", 50_800, {
      range: "30d",
      direction: "expense",
      type: "grading_fee",
      q: "psa",
      page: 1,
    }, db);

    expect(dashboard.activity.items).toHaveLength(1);
    expect(dashboard.activity.items[0]?.label).toBe("PSA grading");
    expect(dashboard.summary.net).toBe(800);
  });
});
