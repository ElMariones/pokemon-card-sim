import { NextResponse } from "next/server";
import { requirePlayer } from "@/server/session";
import {
  FINANCE_RANGES, getFinanceDashboard, type FinanceRange,
} from "@/server/finance-service";
import { settleMarket } from "@/server/market-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const player = await requirePlayer();
  if (!player) return NextResponse.json({ error: "No session" }, { status: 401 });

  // Finance is another view of the same stall economy. Resolve visitors first
  // so a sale that happened while away appears in both cash and the ledger.
  await settleMarket(player.id);
  const currentPlayer = await requirePlayer();

  const params = new URL(request.url).searchParams;
  const rawRange = params.get("range") ?? "30d";
  const range = FINANCE_RANGES.includes(rawRange as FinanceRange)
    ? rawRange as FinanceRange
    : "30d";
  const rawDirection = params.get("direction");
  const direction = rawDirection === "income" || rawDirection === "expense"
    ? rawDirection
    : "all";

  const data = await getFinanceDashboard(player.id, currentPlayer?.cash ?? player.cash, {
    range,
    direction,
    type: params.get("type") ?? "",
    q: params.get("q") ?? "",
    page: Math.max(1, Number(params.get("page") ?? 1) || 1),
  });
  return NextResponse.json(data);
}
