"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { money, relativeTime } from "@/lib/format";
import { usePlayer } from "@/components/PlayerProvider";
import { ListCardDialog } from "@/components/ListCardDialog";
import type { Cents } from "@pcs/shared";
import type { PlayerListing, PlayerSale } from "./types";

const OUTLOOK_TONE: Record<string, string> = {
  quick: "text-gain", fair: "text-manila", patient: "text-brass", slow: "text-loss", stale: "text-loss",
};

function waitLabel(seconds: number): string {
  if (!Number.isFinite(seconds)) return "unlikely to sell";
  if (seconds < 120) return "about a minute";
  if (seconds < 3_600) return `about ${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `about ${Math.round(seconds / 3_600)} h`;
  return `about ${Math.round(seconds / 86_400)} days`;
}

function Summary({ active, sold }: { active: PlayerListing[]; sold: PlayerSale[] }) {
  const stats = useMemo(() => ({
    listed: active.reduce((sum, item) => sum + item.askPrice, 0),
    net: active.reduce((sum, item) => sum + item.netIfSold, 0),
    visits: active.reduce((sum, item) => sum + item.visits, 0),
    sold: sold.reduce((sum, item) => sum + item.netProceeds, 0),
  }), [active, sold]);
  return (
    <dl className="mb-7 grid grid-cols-2 divide-x divide-y divide-seam overflow-hidden rounded-pane border border-seam bg-vitrine sm:grid-cols-4 sm:divide-y-0">
      {[
        ["Cards on display", String(active.length)],
        ["Listed value", money(stats.listed as Cents)],
        ["Expected net", money(stats.net as Cents)],
        ["Recent takings", money(stats.sold as Cents)],
      ].map(([label, value], index) => (
        <div key={label} className={cn("p-4", index === 2 && "border-l-0 sm:border-l")}>
          <dt className="text-[10px] text-manila-3">{label}</dt>
          <dd className="t-num mt-1 text-lg text-manila">{value}</dd>
          {label === "Cards on display" && <span className="text-[10px] text-manila-3">{stats.visits} visitor{stats.visits === 1 ? "" : "s"}</span>}
        </div>
      ))}
    </dl>
  );
}

export function SellMarket() {
  const { player, loading: playerLoading, refresh } = usePlayer();
  const [active, setActive] = useState<PlayerListing[]>([]);
  const [sold, setSold] = useState<PlayerSale[]>([]);
  const [justSold, setJustSold] = useState<PlayerSale[]>([]);
  const [listing, setListing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const response = await fetch("/api/market");
    if (response.ok) {
      const data = await response.json();
      setActive(data.active ?? []);
      setSold(data.sold ?? []);
      if (data.justSold?.length) { setJustSold(data.justSold); void refresh(); }
    } else setError("Could not check your stall");
    setLoading(false);
  }, [refresh]);

  useEffect(() => {
    if (playerLoading || !player) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, player, playerLoading]);
  useEffect(() => {
    if (active.length === 0) return;
    const timer = setInterval(() => { void load(); }, 20_000);
    return () => clearInterval(timer);
  }, [active.length, load]);

  const cancel = async (listingId: string) => {
    setError(null);
    const response = await fetch("/api/market/cancel", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId }),
    });
    if (!response.ok) { setError((await response.json()).error ?? "Could not take that card back"); return; }
    await load();
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="t-display text-2xl">Your stall</h2>
          <p className="mt-1 max-w-2xl text-sm text-manila-2">Set the price and let collectors come to you. The dealer pays now; your stall can pay more if you wait.</p>
        </div>
        <button type="button" onClick={() => setListing(true)} className="min-h-11 rounded-pane bg-brass px-5 text-sm font-semibold text-ink transition hover:bg-brass-hot">List a card</button>
      </div>

      {error && <p role="alert" className="mb-5 rounded-pane p-3 text-sm text-loss ring-1 ring-loss/40">{error}</p>}
      {justSold.length > 0 && (
        <div className="deal-success pane mb-6 border-brass-dim p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-brass">Your stall made a sale</p>
              {justSold.map((sale) => <p key={sale.id} className="mt-1 text-xs text-manila-2">{sale.name} went to {sale.buyerName} for {money(sale.netProceeds as Cents)} after fees.</p>)}
            </div>
            <button type="button" onClick={() => setJustSold([])} className="text-xs text-manila-3 hover:text-manila">Dismiss</button>
          </div>
        </div>
      )}

      <Summary active={active} sold={sold} />

      <section>
        <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">On display</h3><span className="t-mono text-[10px] text-manila-3">5% sale fee</span></div>
        {loading || playerLoading ? <p className="pane p-7 text-sm text-manila-3">Checking the display case…</p> : active.length === 0 ? (
          <div className="market-empty-slot rounded-pane border border-dashed border-seam p-10 text-center"><p className="text-sm text-manila-2">Your display case is empty.</p><p className="mt-1 text-xs text-manila-3">List a card to earn more than the dealer’s instant offer.</p></div>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {active.map((item) => {
              const position = Math.min(100, Math.max(3, item.ratioBp / 150));
              return (
                <li key={item.id} className="pane p-4">
                  <div className="flex gap-4">
                    <div className="relative h-24 w-[68px] shrink-0 overflow-hidden rounded-[6px] bg-vitrine-3 ring-1 ring-seam">{item.imageSmall && <Image src={item.imageSmall} alt="" fill sizes="68px" unoptimized className="object-cover" />}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0"><p className="truncate text-sm font-semibold">{item.name}</p><p className="truncate text-[10px] text-manila-3">{item.setName} · #{item.number} · {relativeTime(item.listedAt)}</p></div>
                        <div className="shrink-0 text-right"><p className="t-num text-base text-brass">{money(item.askPrice as Cents)}</p><p className="text-[9px] text-manila-3">you get {money(item.netIfSold as Cents)}</p></div>
                      </div>
                      <div className="mt-3">
                        <div className="relative h-1.5 rounded-full bg-vitrine-3"><div className="absolute top-0 bottom-0 left-0 rounded-full bg-brass/75 transition-[width]" style={{ width: `${position}%` }} /><span className="absolute top-1/2 left-[66.67%] h-3 w-px -translate-y-1/2 bg-manila-3" title="Market price" /></div>
                        <div className="mt-1 flex justify-between text-[9px] text-manila-3"><span>Quick sale</span><span>Market</span><span>Patient</span></div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]"><span className={OUTLOOK_TONE[item.outlook] ?? "text-manila-2"}>{item.outlookLabel}</span><span className="text-manila-3">Estimated {waitLabel(item.expectedSeconds)}</span><span className="text-manila-3">{item.visits} visitor{item.visits === 1 ? "" : "s"}</span></div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-seam pt-3"><p className="text-[10px] text-manila-3">Dealer would pay {money(item.dealerAlternative as Cents)} now</p><button type="button" onClick={() => void cancel(item.id)} className="min-h-9 rounded-pane px-3 text-xs text-manila-2 ring-1 ring-seam transition hover:text-manila hover:ring-brass">Take back</button></div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {sold.length > 0 && (
        <section className="mt-9 border-t border-seam pt-6"><h3 className="mb-3 text-sm font-semibold">Sales ledger</h3><ul className="divide-y divide-seam overflow-hidden rounded-pane border border-seam bg-vitrine">
          {sold.map((sale) => <li key={sale.id} className="flex items-center gap-3 px-3 py-2.5"><div className="relative h-10 w-7 shrink-0 overflow-hidden rounded-[3px] bg-vitrine-3">{sale.imageSmall && <Image src={sale.imageSmall} alt="" fill sizes="28px" unoptimized className="object-cover" />}</div><div className="min-w-0 flex-1"><p className="truncate text-xs">{sale.name}</p><p className="truncate text-[10px] text-manila-3">{sale.buyerName} · {sale.buyerNote} · {relativeTime(sale.soldAt)}</p></div><div className="text-right"><p className="t-num text-xs text-gain">+{money(sale.netProceeds as Cents)}</p><p className="text-[9px] text-manila-3">{money(sale.feePaid as Cents)} fee</p></div></li>)}
        </ul></section>
      )}

      {listing && <ListCardDialog onClose={() => setListing(false)} onListed={() => { setListing(false); void load(); void refresh(); }} />}
    </div>
  );
}
