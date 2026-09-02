"use client";

import { cn } from "@/lib/cn";
import { usePreservedScroll, useQueryState } from "@/lib/nav-state";
import { BuyMarket } from "@/components/market/BuyMarket";
import { SellMarket } from "@/components/market/SellMarket";

export default function MarketPage() {
  usePreservedScroll();
  const [side, setSide] = useQueryState("side", "buy");
  const current = side === "sell" ? "sell" : "buy";

  return (
    <div className="mx-auto max-w-7xl px-4 py-7 sm:px-5 sm:py-9">
      <header className="mb-6 flex flex-col gap-5 border-b border-seam pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="t-display text-3xl tracking-tight sm:text-4xl">The card market</h1>
          <p className="mt-1 max-w-2xl text-sm text-manila-2">Walk the dealer circuit for cards worth chasing, or put your own collection on the table.</p>
        </div>
        <div className="grid min-w-[260px] grid-cols-2 rounded-pane bg-vitrine-3 p-1 ring-1 ring-seam" role="tablist" aria-label="Market side">
          {(["buy", "sell"] as const).map((tab) => (
            <button
              type="button"
              key={tab}
              role="tab"
              aria-selected={current === tab}
              onClick={() => setSide(tab)}
              className={cn(
                "min-h-10 rounded-[4px] px-5 text-sm font-semibold transition",
                current === tab ? "bg-brass text-ink shadow-[0_4px_14px_rgba(0,0,0,.35)]" : "text-manila-2 hover:text-manila",
              )}
            >
              {tab === "buy" ? "Buy cards" : "Sell cards"}
            </button>
          ))}
        </div>
      </header>
      <div role="tabpanel" key={current} className="market-tab-enter">
        {current === "buy" ? <BuyMarket /> : <SellMarket />}
      </div>
    </div>
  );
}
