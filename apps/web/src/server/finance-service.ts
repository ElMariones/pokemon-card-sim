import { and, asc, desc, eq, gte, inArray, ne, sql, type SQL } from "drizzle-orm";
import { getDb, type Database } from "@pcs/db";
import {
  cards, grades, inventoryItems, listings, sets, transactions,
} from "@pcs/db/schema";
import { inventoryValueSql } from "./value-sql";

export const FINANCE_RANGES = ["7d", "30d", "90d", "all"] as const;
export type FinanceRange = (typeof FINANCE_RANGES)[number];

type LedgerRow = {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  itemType: string | null;
  itemId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

export interface FinanceFilters {
  range: FinanceRange;
  direction: "all" | "income" | "expense";
  type: string;
  q: string;
  page: number;
  pageSize?: number;
}

const TYPE_LABEL: Record<string, string> = {
  starting_balance: "Starting cash",
  pack_purchase: "Pack purchase",
  card_sale: "Card sale",
  card_purchase: "Card purchase",
  grading_fee: "Grading fee",
  sealed_purchase: "Sealed product",
  sealed_sale: "Sealed sale",
  mission_reward: "Mission reward",
  level_reward: "Level reward",
};

function stringMeta(meta: Record<string, unknown> | null, key: string): string | null {
  const value = meta?.[key];
  return typeof value === "string" && value ? value : null;
}

function numberMeta(meta: Record<string, unknown> | null, key: string): number | null {
  const value = meta?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isLedgerAdjustment(row: LedgerRow): boolean {
  return row.type === "starting_balance" || (
    row.type === "sealed_purchase" && row.amount > 0 &&
    stringMeta(row.metadata, "reason") === "pack included in sealed product"
  );
}

function rangeStart(range: FinanceRange, now: Date): Date | null {
  if (range === "all") return null;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  return new Date(now.getTime() - days * 86_400_000);
}

function bucketStart(date: Date, mode: "day" | "week" | "month"): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (mode === "month") return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  if (mode === "week") {
    const mondayOffset = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - mondayOffset);
  }
  return d;
}

function nextBucket(date: Date, mode: "day" | "week" | "month"): Date {
  const next = new Date(date);
  if (mode === "month") next.setUTCMonth(next.getUTCMonth() + 1);
  else next.setUTCDate(next.getUTCDate() + (mode === "week" ? 7 : 1));
  return next;
}

function bucketKey(date: Date, mode: "day" | "week" | "month"): string {
  return mode === "month" ? date.toISOString().slice(0, 7) : date.toISOString().slice(0, 10);
}

function buildTimeline(rows: LedgerRow[], range: FinanceRange, cash: number, now: Date) {
  const mode = range === "all" ? "month" : range === "90d" ? "week" : "day";
  const requestedStart = rangeStart(range, now);
  const firstDate = rows[0]?.createdAt ?? requestedStart ?? now;
  const start = bucketStart(requestedStart ?? firstDate, mode);
  const end = bucketStart(now, mode);
  const openingBalance = rows[0] ? rows[0].balanceAfter - rows[0].amount : cash;
  const grouped = new Map<string, { income: number; expense: number; net: number; balance: number }>();
  let running = openingBalance;

  for (const row of rows) {
    running = row.balanceAfter;
    const key = bucketKey(bucketStart(row.createdAt, mode), mode);
    const current = grouped.get(key) ?? { income: 0, expense: 0, net: 0, balance: running };
    if (!isLedgerAdjustment(row)) {
      if (row.amount >= 0) current.income += row.amount;
      else current.expense += Math.abs(row.amount);
      current.net += row.amount;
    }
    current.balance = running;
    grouped.set(key, current);
  }

  const points: Array<{ date: string; income: number; expense: number; net: number; balance: number }> = [];
  running = openingBalance;
  for (let cursor = start; cursor <= end; cursor = nextBucket(cursor, mode)) {
    const date = bucketKey(cursor, mode);
    const values = grouped.get(date);
    if (values) running = values.balance;
    points.push({
      date,
      income: values?.income ?? 0,
      expense: values?.expense ?? 0,
      net: values?.net ?? 0,
      balance: running,
    });
  }
  return { mode, points };
}

function describeRow(
  row: LedgerRow,
  directCards: Map<string, { name: string; imageSmall: string | null }>,
  marketCards: Map<string, { name: string; imageSmall: string | null }>,
) {
  const direct = row.itemId ? directCards.get(row.itemId) : null;
  const market = row.itemId ? marketCards.get(row.itemId) : null;
  const metaName = stringMeta(row.metadata, "name");
  const setId = stringMeta(row.metadata, "setId");
  const company = stringMeta(row.metadata, "company");
  const via = stringMeta(row.metadata, "via");
  const count = numberMeta(row.metadata, "count");
  const adjustment = isLedgerAdjustment(row);

  let label = TYPE_LABEL[row.type] ?? row.type.replaceAll("_", " ");
  let detail = "Recorded in the cash ledger";
  let imageSmall: string | null = null;

  if (row.type === "card_sale") {
    const card = market ?? direct;
    label = card?.name ?? metaName ?? (via === "bulk_duplicates" ? "Duplicate card batch" : "Card sale");
    detail = via === "marketplace"
      ? `Marketplace sale${stringMeta(row.metadata, "buyer") ? ` to ${stringMeta(row.metadata, "buyer")}` : ""}`
      : via === "bulk_duplicates"
        ? `${count ?? 0} duplicate cards sold to the dealer`
        : "Sold to the dealer";
    imageSmall = card?.imageSmall ?? null;
  } else if (row.type === "pack_purchase") {
    label = "Booster pack";
    detail = setId ? `Set ${setId}` : "Pack opened";
  } else if (row.type === "sealed_purchase") {
    label = adjustment ? "Included pack offset" : "Sealed product";
    detail = adjustment ? "Already paid as part of a sealed product" : (setId ? `Set ${setId}` : "Product purchased");
  } else if (row.type === "grading_fee") {
    label = `${company ?? "Card"} grading`;
    detail = `${count ?? 1} card${count === 1 ? "" : "s"} submitted`;
  } else if (row.type === "sealed_sale") {
    detail = "Sealed holding sold";
  } else if (row.type === "mission_reward") {
    detail = "Mission completed";
  }

  return {
    id: row.id,
    type: row.type,
    typeLabel: TYPE_LABEL[row.type] ?? row.type.replaceAll("_", " "),
    amount: row.amount,
    balanceAfter: row.balanceAfter,
    createdAt: row.createdAt.toISOString(),
    label,
    detail,
    imageSmall,
    direction: adjustment ? "adjustment" : row.amount >= 0 ? "income" : "expense",
  };
}

export async function getFinanceDashboard(
  userId: string,
  cash: number,
  filters: FinanceFilters,
  database?: Database,
) {
  const db = database ?? await getDb();
  const now = new Date();
  const since = rangeStart(filters.range, now);
  const txWhere: SQL = since
    ? and(eq(transactions.userId, userId), gte(transactions.createdAt, since))!
    : eq(transactions.userId, userId);

  const gradeJoin = and(
    eq(grades.inventoryItemId, inventoryItems.id),
    eq(grades.status, "completed"),
  );
  const heldCards = and(
    eq(inventoryItems.userId, userId),
    eq(inventoryItems.type, "card"),
    ne(inventoryItems.status, "sold"),
  );
  const value = inventoryValueSql();

  const [ledgerRows, portfolioAgg, topCards, setValues] = await Promise.all([
    db.select({
      id: transactions.id,
      type: transactions.type,
      amount: transactions.amount,
      balanceAfter: transactions.balanceAfter,
      itemType: transactions.itemType,
      itemId: transactions.itemId,
      metadata: transactions.metadata,
      createdAt: transactions.createdAt,
    }).from(transactions).where(txWhere).orderBy(asc(transactions.createdAt)),
    db.select({
      totalValue: sql<number>`coalesce(sum(${value}), 0)::bigint`,
      copies: sql<number>`count(*)::int`,
      uniqueCards: sql<number>`count(distinct ${cards.id})::int`,
      gradedCopies: sql<number>`count(${grades.id})::int`,
    }).from(inventoryItems)
      .innerJoin(cards, eq(cards.id, inventoryItems.cardId))
      .leftJoin(grades, gradeJoin)
      .where(heldCards),
    db.select({
      inventoryId: inventoryItems.id,
      cardId: cards.id,
      name: cards.name,
      setName: sets.name,
      imageSmall: cards.imageSmall,
      value,
      gradeCompany: grades.gradeCompany,
      numericGrade: grades.numericGrade,
    }).from(inventoryItems)
      .innerJoin(cards, eq(cards.id, inventoryItems.cardId))
      .innerJoin(sets, eq(sets.id, cards.setId))
      .leftJoin(grades, gradeJoin)
      .where(heldCards)
      .orderBy(desc(value))
      .limit(6),
    db.select({
      setId: sets.id,
      setName: sets.name,
      value: sql<number>`coalesce(sum(${value}), 0)::bigint`,
      copies: sql<number>`count(*)::int`,
    }).from(inventoryItems)
      .innerJoin(cards, eq(cards.id, inventoryItems.cardId))
      .innerJoin(sets, eq(sets.id, cards.setId))
      .leftJoin(grades, gradeJoin)
      .where(heldCards)
      .groupBy(sets.id, sets.name)
      .orderBy(desc(sql`sum(${value})`))
      .limit(6),
  ]);

  const rows = ledgerRows as LedgerRow[];
  const directIds = rows.filter((r) => r.itemType === "card" && r.itemId).map((r) => r.itemId!);
  const listingIds = rows.filter((r) => r.itemType === "listing" && r.itemId).map((r) => r.itemId!);
  const [directRows, marketRows] = await Promise.all([
    directIds.length
      ? db.select({ id: cards.id, name: cards.name, imageSmall: cards.imageSmall })
          .from(cards).where(inArray(cards.id, [...new Set(directIds)]))
      : Promise.resolve([]),
    listingIds.length
      ? db.select({ id: listings.id, name: cards.name, imageSmall: cards.imageSmall })
          .from(listings).innerJoin(cards, eq(cards.id, listings.cardId))
          .where(inArray(listings.id, [...new Set(listingIds)]))
      : Promise.resolve([]),
  ]);
  const directMap = new Map(directRows.map((r) => [r.id, r]));
  const marketMap = new Map(marketRows.map((r) => [r.id, r]));
  const activity = rows.map((row) => describeRow(row, directMap, marketMap));
  const economicRows = rows.filter((row) => !isLedgerAdjustment(row));
  const income = economicRows.reduce((sum, row) => sum + Math.max(0, row.amount), 0);
  const expenses = economicRows.reduce((sum, row) => sum + Math.max(0, -row.amount), 0);

  const query = filters.q.trim().toLowerCase();
  const filtered = activity.filter((row) => {
    if (filters.direction !== "all" && row.direction !== filters.direction) return false;
    if (filters.type && row.type !== filters.type) return false;
    if (query && !`${row.label} ${row.detail} ${row.typeLabel}`.toLowerCase().includes(query)) return false;
    return true;
  });
  const pageSize = Math.min(50, Math.max(10, filters.pageSize ?? 20));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, filters.page));
  const saleRows = activity
    .filter((row) => row.type === "card_sale" && row.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
  const portfolio = portfolioAgg[0];
  const portfolioValue = Number(portfolio?.totalValue ?? 0);

  return {
    range: filters.range,
    summary: {
      cash,
      income,
      expenses,
      net: income - expenses,
      portfolioValue,
      trackedWealth: cash + portfolioValue,
      transactions: economicRows.length,
    },
    timeline: buildTimeline(rows, filters.range, cash, now),
    activity: {
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
      total: filtered.length,
      page,
      pageCount,
      types: [...new Set(rows.map((row) => row.type))]
        .sort()
        .map((type) => ({ value: type, label: TYPE_LABEL[type] ?? type.replaceAll("_", " ") })),
    },
    biggestSales: saleRows,
    cards: {
      totalValue: portfolioValue,
      copies: Number(portfolio?.copies ?? 0),
      uniqueCards: Number(portfolio?.uniqueCards ?? 0),
      gradedCopies: Number(portfolio?.gradedCopies ?? 0),
      top: topCards.map((card) => ({ ...card, value: Number(card.value) })),
      bySet: setValues.map((set) => ({ ...set, value: Number(set.value), copies: Number(set.copies) })),
    },
  };
}
