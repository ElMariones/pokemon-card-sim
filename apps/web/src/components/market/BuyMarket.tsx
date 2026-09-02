"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { CardFace } from "@/components/CardFace";
import { CardDetail } from "@/components/CardDetail";
import { GradedSlab } from "@/components/GradedSlab";
import { usePlayer } from "@/components/PlayerProvider";
import { NegotiationDrawer } from "./NegotiationDrawer";
import type { NpcMarketData, NpcStock } from "./types";

const DEMAND: Record<string, { label: string; tone: string }> = {
  quiet: { label: "Quiet", tone: "text-manila-3" },
  some_interest: { label: "Some interest", tone: "text-manila-2" },
  drawing_attention: { label: "Drawing attention", tone: "text-brass" },
  likely_to_move: { label: "Likely to move", tone: "text-loss" },
};

function refreshLabel(iso: string, now: number) {
  const seconds = Math.max(0, Math.round((new Date(iso).getTime() - now) / 1_000));
  if (seconds < 60) return "refreshing soon";
  if (seconds < 3_600) return `new stock in ${Math.ceil(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.ceil((seconds % 3_600) / 60);
  return `new stock in ${hours}h ${minutes}m`;
}

function MarketCard({ stock, onDeal, onInspect }: {
  stock: NpcStock;
  onDeal: () => void;
  onInspect: () => void;
}) {
  const demand = DEMAND[stock.demandBand] ?? DEMAND.quiet;
  const markup = stock.marketValue > 0 ? Math.round((stock.askPrice / stock.marketValue - 1) * 100) : 0;
  const card = (
    <CardFace
      name={stock.name}
      imageUrl={stock.imageLarge ?? stock.imageSmall}
      rarityTier={stock.rarityTier}
      flippable={false}
      className="w-full"
      maxTilt={8}
    />
  );

  return (
    <article className="market-stock-card group relative min-w-0">
      {stock.isNew && <span className="market-new-stamp absolute right-2 top-2 z-20 rounded-full bg-brass px-2 py-1 text-[9px] font-bold text-ink shadow-lg">New</span>}
      <div className="relative mx-auto w-full max-w-[230px] px-2 pt-2">
        {stock.grade ? (
          <GradedSlab grade={stock.grade} cardName={stock.name} setName={stock.setName} certSeed={stock.id} compact>
            {card}
          </GradedSlab>
        ) : card}
      </div>

      <div className="mt-3 border-t border-seam px-3 pt-3 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{stock.name}</h3>
            <p className="truncate text-[10px] text-manila-3">
              {stock.grade ? `${stock.grade.company} ${stock.grade.numericGrade}` : stock.conditionLabel}
              {" · "}{stock.setName}
            </p>
          </div>
          <p className="t-num shrink-0 text-base text-brass">{money(stock.askPrice)}</p>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
          <span className={demand.tone}>{demand.label}</span>
          <span className="text-manila-3">Market {money(stock.marketValue)}{markup > 0 ? ` · +${markup}%` : ""}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={onInspect} className="min-h-10 rounded-pane text-xs text-manila-2 ring-1 ring-seam transition hover:text-manila hover:ring-seam-bright">Inspect</button>
          <button type="button" onClick={onDeal} className="min-h-10 rounded-pane bg-brass text-xs font-semibold text-ink transition hover:bg-brass-hot">Make a deal</button>
        </div>
      </div>
    </article>
  );
}

export function BuyMarket() {
  const { player, loading: playerLoading } = usePlayer();
  const [data, setData] = useState<NpcMarketData | null>(null);
  const [selectedDealer, setSelectedDealer] = useState<string | null>(null);
  const [negotiating, setNegotiating] = useState<NpcStock | null>(null);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/market/buy");
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Could not open the dealer circuit");
      setData(json);
      setNow(new Date(json.serverTime).getTime());
      setSelectedDealer((current) => current ?? json.dealers?.[0]?.id ?? null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open the dealer circuit");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (playerLoading || !player) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, player, playerLoading]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    const settle = setInterval(() => { if (!negotiating) void load(); }, 60_000);
    return () => { clearInterval(timer); clearInterval(settle); };
  }, [load, negotiating]);

  const dealer = useMemo(
    () => data?.dealers.find((item) => item.id === selectedDealer) ?? data?.dealers[0] ?? null,
    [data, selectedDealer],
  );

  if (loading || playerLoading) {
    return <div className="grid min-h-[420px] place-items-center"><div className="market-loading-case" aria-label="Opening the dealer circuit"><span /></div></div>;
  }

  if (error || !data || !dealer) {
    return (
      <div className="pane mx-auto max-w-lg p-8 text-center">
        <p role="alert" className="text-sm text-loss">{error ?? "No dealers are available."}</p>
        <button type="button" onClick={() => { setLoading(true); void load(); }} className="mt-4 rounded-pane bg-brass px-4 py-2 text-sm font-semibold text-ink">Try again</button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-7 grid gap-5 lg:grid-cols-[250px_1fr]">
        <nav aria-label="Card dealers" className="flex snap-x gap-2 overflow-x-auto pb-2 lg:block lg:space-y-2 lg:overflow-visible lg:pb-0">
          {data.dealers.map((item) => {
            const selected = item.id === dealer.id;
            return (
              <button
                type="button"
                key={item.id}
                onClick={() => setSelectedDealer(item.id)}
                aria-current={selected ? "true" : undefined}
                className={cn(
                  "dealer-ticket min-w-[215px] snap-start rounded-pane p-3 text-left ring-1 transition lg:min-w-0 lg:w-full",
                  selected ? "bg-vitrine-2 ring-brass" : "bg-vitrine/70 ring-seam hover:ring-seam-bright",
                )}
              >
                <span className="flex items-center gap-3">
                  <span className={cn("dealer-monogram grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-bold", selected ? "bg-brass text-ink" : "bg-vitrine-3 text-manila-2 ring-1 ring-seam")}>{item.monogram}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{item.name}</span>
                    <span className="block truncate text-[10px] text-manila-3">{item.shopName}</span>
                  </span>
                  <span className="t-num text-xs text-manila-2">{item.stock.length}</span>
                </span>
                <span className="mt-2 block text-[10px] text-manila-3">{refreshLabel(item.refreshAt, now)}</span>
              </button>
            );
          })}
        </nav>

        <section aria-labelledby="selected-dealer" className="min-w-0">
          <header className="dealer-header relative mb-4 overflow-hidden rounded-pane border border-seam bg-vitrine p-5 sm:p-6">
            <div className="dealer-case-light" aria-hidden />
            <div className="relative flex items-start gap-4">
              <div className="dealer-portrait grid h-16 w-16 shrink-0 place-items-center rounded-full text-lg font-bold text-brass ring-1 ring-brass/40 sm:h-20 sm:w-20">{dealer.monogram}</div>
              <div className="min-w-0">
                <p className="text-xs text-manila-3">{dealer.shopName}</p>
                <h2 id="selected-dealer" className="t-display text-2xl sm:text-3xl">{dealer.name}</h2>
                <p className="mt-1 max-w-2xl text-sm text-manila-2">{dealer.specialty}</p>
                <p className="mt-3 max-w-2xl text-xs italic text-manila-3">“{dealer.note}”</p>
              </div>
              <div className="ml-auto hidden shrink-0 text-right sm:block">
                <p className="text-[10px] text-manila-3">Case rotation</p>
                <p className="t-mono mt-1 text-xs text-brass">{refreshLabel(dealer.refreshAt, now)}</p>
              </div>
            </div>
          </header>

          <div key={dealer.id} className="market-stock-grid grid grid-cols-2 gap-3 sm:grid-cols-3">
            {dealer.stock.map((stock) => (
              <MarketCard key={stock.id} stock={stock} onDeal={() => setNegotiating(stock)} onInspect={() => setInspecting(stock.cardId)} />
            ))}
            {Array.from({ length: dealer.emptySlots }).map((_, index) => (
              <div key={`empty-${index}`} className="market-empty-slot grid min-h-[260px] place-items-center rounded-pane border border-dashed border-seam p-5 text-center sm:min-h-[340px]">
                <div>
                  <span className="mx-auto block h-14 w-10 rounded-[5px] border border-seam bg-vitrine-3/50" />
                  <p className="mt-3 text-xs text-manila-2">Sold to another collector</p>
                  <p className="mt-1 text-[10px] text-manila-3">{refreshLabel(dealer.refreshAt, now)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {data.activity.length > 0 && (
        <aside className="market-activity pane overflow-hidden" aria-label="Recent dealer activity">
          <div className="market-activity-track flex min-w-max items-center gap-7 px-4 py-3 text-xs text-manila-2">
            <span className="font-semibold text-brass">Around the market</span>
            {[...data.activity, ...data.activity].map((item, index) => {
              const activityDealer = data.dealers.find((candidate) => candidate.id === item.shopId);
              const slab = item.gradeCompany ? `${item.gradeCompany} ${item.numericGrade} ` : "";
              return <span key={`${item.id}-${index}`}>{slab}{item.name} {item.status === "purchased" ? "joined your collection" : `sold at ${activityDealer?.name ?? "a dealer"}’s counter`}</span>;
            })}
          </div>
        </aside>
      )}

      {negotiating && (
        <NegotiationDrawer stock={negotiating} dealer={data.dealers.find((item) => item.id === negotiating.shopId)!} onClose={() => setNegotiating(null)} onPurchased={() => { setNegotiating(null); void load(); }} />
      )}
      {inspecting && <CardDetail cardId={inspecting} onClose={() => setInspecting(null)} />}
    </div>
  );
}
