"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Landmark, Layers3, ReceiptText, WalletCards } from "lucide-react";
import { BorderGlow } from "@/components/BorderGlow";
import { GradientText } from "@/components/GradientText";
import { MoneyFlowChart, type MoneyPoint } from "@/components/MoneyFlowChart";
import { usePlayer } from "@/components/PlayerProvider";
import { cn } from "@/lib/cn";
import { money, moneyCompact, relativeTime } from "@/lib/format";
import { usePreservedScroll, useQueryState } from "@/lib/nav-state";
import type { Cents } from "@pcs/shared";

interface ActivityRow {
  id: string; type: string; typeLabel: string; amount: number; balanceAfter: number;
  createdAt: string; label: string; detail: string; imageSmall: string | null;
  direction: "income" | "expense" | "adjustment";
}
interface FinanceData {
  range: string;
  summary: {
    cash: number; income: number; expenses: number; net: number;
    portfolioValue: number; trackedWealth: number; transactions: number;
  };
  timeline: { mode: "day" | "week" | "month"; points: MoneyPoint[] };
  activity: {
    items: ActivityRow[]; total: number; page: number; pageCount: number;
    types: { value: string; label: string }[];
  };
  biggestSales: ActivityRow[];
  cards: {
    totalValue: number; copies: number; uniqueCards: number; gradedCopies: number;
    top: { inventoryId: string; cardId: string; name: string; setName: string; imageSmall: string | null; value: number; gradeCompany: string | null; numericGrade: number | null }[];
    bySet: { setId: string; setName: string; value: number; copies: number }[];
  };
}

const financeCache = new Map<string, { data: FinanceData; savedAt: number }>();
const RANGE_OPTIONS = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "all", label: "All time" },
];

export default function FinancesPage() {
  const { setCash } = usePlayer();
  usePreservedScroll();
  const [range, setRange] = useQueryState("range", "30d");
  const [direction, setDirection] = useQueryState("direction", "all");
  const [type, setType] = useQueryState("type", "");
  const [q, setQ] = useQueryState("q", "");
  const [page, setPage] = useQueryState("page", "1");
  const [debouncedQ, setDebouncedQ] = useState(q);
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedQ(q); setPage("1"); }, 220);
    return () => clearTimeout(timer);
    // `setPage` is deliberately not a dependency. Its identity changes whenever
    // any query param does, so listing it made every "Next page" click re-arm
    // this timer, which then reset the ledger to page 1 a fifth of a second
    // later. It is only ever called, never read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const query = useMemo(() => {
    const params = new URLSearchParams({ range, direction, page });
    if (type) params.set("type", type);
    if (debouncedQ) params.set("q", debouncedQ);
    return params.toString();
  }, [range, direction, type, debouncedQ, page]);

  const load = useCallback(async () => {
    const cached = financeCache.get(query);
    if (cached) {
      setData(cached.data);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const response = await fetch(`/api/finances?${query}`);
      if (!response.ok) throw new Error("Could not read the money ledger");
      const next = await response.json() as FinanceData;
      financeCache.set(query, { data: next, savedAt: Date.now() });
      setData(next);
      setCash(next.summary.cash as Cents);
    } catch (cause) {
      if (!cached) setError(cause instanceof Error ? cause.message : "Could not load finances");
    } finally {
      setLoading(false);
    }
  }, [query, setCash]);

  useEffect(() => {
    // External fetch resolution, not synchronous derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    const onSale = () => {
      financeCache.clear();
      void load();
    };
    window.addEventListener("pcs:market-updated" as never, onSale as never);
    return () => window.removeEventListener("pcs:market-updated" as never, onSale as never);
  }, [load]);

  const resetPage = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPage("1");
  };

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="t-eyebrow text-brass mb-2">Cash room</p>
          <h1 className="t-display text-3xl tracking-tight">Money tracker</h1>
          <p className="text-manila-2 mt-2 max-w-2xl text-sm">
            Every pack, sale, grading fee and reward, reconciled against your balance.
          </p>
        </div>
        <div className="bg-vitrine ring-seam inline-flex rounded-pane p-1 ring-1" role="group" aria-label="Time range">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={range === option.value}
              onClick={() => resetPage(setRange, option.value)}
              className={cn(
                "rounded-[4px] px-3 py-2 text-xs transition",
                range === option.value ? "bg-brass text-ink font-semibold" : "text-manila-3 hover:text-manila",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {error && <p role="alert" className="text-loss ring-loss/40 mb-6 rounded-pane p-4 text-sm ring-1">{error}</p>}

      {loading && !data ? (
        <div className="pane grid min-h-72 place-items-center"><p className="text-manila-3 text-sm">Reconciling the ledger…</p></div>
      ) : data ? (
        <>
          <section className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6" aria-label="Financial summary">
            <BorderGlow animated className="sm:col-span-2 lg:col-span-2" glowColor="211 160 60">
              <MetricCard
                className="h-full min-h-32"
                icon={Landmark}
                label="Cash on hand"
                value={<GradientText>{money(data.summary.cash as Cents)}</GradientText>}
                note={`${data.summary.transactions} real movements in this view`}
              />
            </BorderGlow>
            <MetricCard icon={ArrowUpRight} label="Income" value={money(data.summary.income as Cents)} note="Sales and rewards" tone="gain" />
            <MetricCard icon={ArrowDownRight} label="Spent" value={money(data.summary.expenses as Cents)} note="Packs, sealed and grading" tone="loss" />
            <MetricCard
              icon={ReceiptText}
              label="Net flow"
              value={`${data.summary.net >= 0 ? "+" : "−"}${money(Math.abs(data.summary.net) as Cents)}`}
              note="Income minus spending"
              tone={data.summary.net >= 0 ? "gain" : "loss"}
            />
            <MetricCard icon={WalletCards} label="Cards value" value={moneyCompact(data.summary.portfolioValue as Cents)} note={`${data.cards.copies} physical cards`} />
          </section>

          <section className="pane mb-5 p-5 sm:p-6">
            <MoneyFlowChart points={data.timeline.points} mode={data.timeline.mode} />
          </section>

          <div className="mb-5 grid gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,.75fr)]">
            <section className="pane min-w-0 overflow-hidden">
              <div className="border-seam flex flex-wrap items-center gap-2 border-b p-4">
                <div className="mr-auto">
                  <h2 className="t-display text-lg">Money log</h2>
                  <p className="text-manila-3 mt-0.5 text-xs">{data.activity.total} matching ledger entries</p>
                </div>
                <input
                  type="search"
                  value={q}
                  onChange={(event) => setQ(event.target.value)}
                  placeholder="Search activity…"
                  aria-label="Search money activity"
                  className="bg-vitrine-3 ring-seam placeholder:text-manila-3 focus:ring-brass w-40 rounded-pane px-3 py-2 text-xs ring-1 outline-none"
                />
                <select
                  value={direction}
                  onChange={(event) => resetPage(setDirection, event.target.value)}
                  aria-label="Filter by direction"
                  className="bg-vitrine-3 ring-seam focus:ring-brass rounded-pane px-2.5 py-2 text-xs ring-1 outline-none"
                >
                  <option value="all">All movement</option>
                  <option value="income">Income</option>
                  <option value="expense">Expenses</option>
                </select>
                <select
                  value={type}
                  onChange={(event) => resetPage(setType, event.target.value)}
                  aria-label="Filter by activity type"
                  className="bg-vitrine-3 ring-seam focus:ring-brass max-w-40 rounded-pane px-2.5 py-2 text-xs ring-1 outline-none"
                >
                  <option value="">Every category</option>
                  {data.activity.types.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>

              {data.activity.items.length === 0 ? (
                <p className="text-manila-3 p-8 text-center text-sm">No ledger entries match these filters.</p>
              ) : (
                <ul className="divide-seam divide-y">
                  {data.activity.items.map((row) => <ActivityItem key={row.id} row={row} />)}
                </ul>
              )}

              {data.activity.pageCount > 1 && (
                <div className="border-seam flex items-center justify-center gap-3 border-t p-3">
                  <button type="button" disabled={data.activity.page <= 1} onClick={() => setPage(String(data.activity.page - 1))} className="ring-seam rounded-pane px-3 py-1.5 text-xs ring-1 disabled:opacity-30">Previous</button>
                  <span className="t-mono text-manila-3 text-xs">{data.activity.page} / {data.activity.pageCount}</span>
                  <button type="button" disabled={data.activity.page >= data.activity.pageCount} onClick={() => setPage(String(data.activity.page + 1))} className="ring-seam rounded-pane px-3 py-1.5 text-xs ring-1 disabled:opacity-30">Next</button>
                </div>
              )}
            </section>

            <section className="pane p-4">
              <div className="mb-4 flex items-baseline justify-between gap-3">
                <div>
                  <p className="t-eyebrow text-manila-3">Personal records</p>
                  <h2 className="t-display mt-1 text-lg">Biggest sales</h2>
                </div>
                <Link href="/market" scroll={false} className="text-brass text-xs hover:underline">Market</Link>
              </div>
              {data.biggestSales.length === 0 ? (
                <p className="text-manila-3 py-8 text-sm">No card sales in this time range yet.</p>
              ) : (
                <ol className="space-y-2">
                  {data.biggestSales.map((sale, index) => (
                    <li key={sale.id} className="bg-vitrine-2/55 ring-seam flex items-center gap-3 rounded-pane p-2.5 ring-1">
                      <span className="t-mono text-manila-3 w-4 text-[10px]">{String(index + 1).padStart(2, "0")}</span>
                      <Thumb src={sale.imageSmall} />
                      <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{sale.label}</p><p className="text-manila-3 truncate text-[10px]">{sale.detail}</p></div>
                      <span className="t-num text-gain text-xs">{money(sale.amount as Cents)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <section className="pane overflow-hidden">
            <div className="border-seam flex flex-wrap items-end justify-between gap-3 border-b p-5">
              <div>
                <p className="t-eyebrow text-manila-3">Collection equity</p>
                <h2 className="t-display mt-1 text-xl">Cards value</h2>
                <p className="text-manila-2 mt-1 text-sm">
                  {money(data.cards.totalValue as Cents)} across {data.cards.uniqueCards} unique cards · {data.cards.gradedCopies} graded
                </p>
              </div>
              <div className="text-right"><p className="t-eyebrow text-manila-3">Cash + cards</p><p className="t-num text-brass text-xl">{money(data.summary.trackedWealth as Cents)}</p></div>
            </div>
            <div className="grid gap-0 lg:grid-cols-[1.25fr_.75fr]">
              <div className="border-seam p-5 lg:border-r">
                <div className="mb-3 flex items-center justify-between"><h3 className="t-eyebrow text-manila-3">Most valuable cards</h3><Link href="/collection?sort=price&dir=desc" scroll={false} className="text-brass text-xs hover:underline">View all</Link></div>
                <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                  {data.cards.top.map((card) => (
                    <li key={card.inventoryId}>
                      <Link href={`/collection?sort=price&dir=desc`} scroll={false} className="group block">
                        <div className="ring-seam group-hover:ring-brass relative aspect-[2.5/3.5] overflow-hidden rounded-[7px] ring-1 transition">
                          {card.imageSmall && <Image src={card.imageSmall} alt="" fill sizes="130px" unoptimized className="object-cover transition duration-300 group-hover:scale-[1.035]" />}
                        </div>
                        <p className="mt-1.5 truncate text-[11px] font-medium">{card.name}</p>
                        <p className="t-num text-brass text-[11px]">{money(card.value as Cents)}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="p-5">
                <h3 className="t-eyebrow text-manila-3 mb-4">Value by set</h3>
                <ul className="space-y-3">
                  {data.cards.bySet.map((set) => {
                    const share = data.cards.totalValue > 0 ? set.value / data.cards.totalValue : 0;
                    return (
                      <li key={set.setId}>
                        <div className="mb-1 flex items-baseline justify-between gap-3"><span className="truncate text-xs">{set.setName}</span><span className="t-num text-manila-2 text-xs">{money(set.value as Cents)}</span></div>
                        <div className="bg-vitrine-3 h-1.5 overflow-hidden rounded-full"><div className="bg-brass h-full rounded-full" style={{ width: `${Math.max(2, share * 100)}%` }} /></div>
                        <p className="text-manila-3 mt-1 text-[10px]">{set.copies} copies · {(share * 100).toFixed(1)}%</p>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, note, tone, className }: {
  icon: typeof Landmark; label: string; value: React.ReactNode; note: string;
  tone?: "gain" | "loss"; className?: string;
}) {
  return (
    <div className={cn("pane min-h-32 p-4", className)}>
      <div className="mb-5 flex items-center justify-between"><p className="t-eyebrow text-manila-3">{label}</p><Icon size={15} className="text-manila-3" aria-hidden="true" /></div>
      <p className={cn("t-num text-xl tabular-nums", tone === "gain" && "text-gain", tone === "loss" && "text-loss")}>{value}</p>
      <p className="text-manila-3 mt-1 text-[10px] leading-snug">{note}</p>
    </div>
  );
}

function Thumb({ src }: { src: string | null }) {
  return <span className="bg-vitrine-3 ring-seam relative h-10 w-7 shrink-0 overflow-hidden rounded-[4px] ring-1">{src && <Image src={src} alt="" fill sizes="28px" unoptimized className="object-cover" />}</span>;
}

function ActivityItem({ row }: { row: ActivityRow }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Thumb src={row.imageSmall} />
      <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full", row.direction === "income" ? "bg-gain/10 text-gain" : row.direction === "expense" ? "bg-loss/10 text-loss" : "bg-vitrine-3 text-manila-3")}>
        {row.direction === "income" ? <ArrowUpRight size={14} /> : row.direction === "expense" ? <ArrowDownRight size={14} /> : <Layers3 size={13} />}
      </span>
      <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{row.label}</p><p className="text-manila-3 truncate text-[10px]">{row.detail} · {relativeTime(row.createdAt)}</p></div>
      <div className="hidden text-right sm:block"><p className="text-manila-3 text-[10px]">Balance</p><p className="t-num text-manila-2 text-xs">{money(row.balanceAfter as Cents)}</p></div>
      <p className={cn("t-num w-20 text-right text-xs", row.direction === "income" ? "text-gain" : row.direction === "expense" ? "text-loss" : "text-manila-3")}>
        {row.amount > 0 ? "+" : row.amount < 0 ? "−" : ""}{money(Math.abs(row.amount) as Cents)}
      </p>
    </li>
  );
}
