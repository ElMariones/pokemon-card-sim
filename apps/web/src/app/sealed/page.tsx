"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { usePlayer } from "@/components/PlayerProvider";
import { usePreservedScroll, useQueryState } from "@/lib/nav-state";
import type { Cents } from "@pcs/shared";

interface Offer {
  productId: string; setId: string; setName: string; logoUrl: string | null;
  type: string; label: string; packs: number;
  price: number; currentValue: number; releaseDate: string;
}
interface Holding {
  inventoryId: string; productId: string; label: string; type: string;
  packs: number; setId: string; setName: string; logoUrl: string | null;
  paid: number; currentValue: number; buyOffer: number; gain: number;
  acquiredAt: string;
}

export default function SealedPage() {
  const { player, refresh, setCash: setHeaderCash } = usePlayer();
  usePreservedScroll();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [cash, setCash] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState<{ label: string; totalValue: number; paid: number; cards: number } | null>(null);
  const [setFilter, setSetFilter] = useQueryState("set", "");

  // Use header cash for affordability, but keep local cash in sync for fallback
  const effectiveCash = player?.cash ?? cash;

  const load = useCallback(async () => {
    const me = await fetch("/api/me").then((r) => (r.ok ? r.json() : null));
    if (me) setCash(me.player?.cash ?? null);
    const s = await fetch("/api/sealed").then((r) => (r.ok ? r.json() : null));
    if (s) { setOffers(s.offers ?? []); setHoldings(s.holdings ?? []); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const post = async (path: string, body: object) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Something went wrong"); return null; }
      if (data?.balanceAfter != null) setHeaderCash(data.balanceAfter);
      if (data?.offer != null && data?.balanceAfter == null) {
        // sellSealed returns balanceAfter, openSealed returns balanceAfter; buySealed doesn't yet
      }
      await load();
      void refresh();
      // Ensure header reflects new balance even if endpoint didn't return it
      if (data?.balanceAfter == null) {
        // buySealed currently has no balanceAfter; fetch it via refresh (already queued)
      }
      return data;
    } finally { setBusy(false); }
  };

  const openIt = async (h: Holding) => {
    const data = await post("/api/sealed/open", { inventoryId: h.inventoryId });
    if (data) {
      setOpened({
        label: data.label,
        totalValue: data.totalValue,
        paid: data.paid,
        cards: (data.packs ?? []).reduce((a: number, p: { cards: unknown[] }) => a + p.cards.length, 0),
      });
    }
  };

  const sets = [...new Set(offers.map((o) => o.setName))].sort();
  const visible = setFilter ? offers.filter((o) => o.setName === setFilter) : offers.slice(0, 25);

  return (
    <>

      <div className="mx-auto max-w-7xl px-5 py-8">
        {error && (
          <p role="alert" className="text-loss ring-loss/40 mb-6 rounded-pane px-4 py-3 text-sm ring-1">
            {error}
          </p>
        )}

        {opened && (
          <div className="pane border-brass-dim mb-8 border p-5">
            <p className="t-eyebrow text-manila-3">Opened</p>
            <h2 className="t-display text-lg">{opened.label}</h2>
            <p className="text-manila-2 mt-1 text-sm">
              {opened.cards} cards worth{" "}
              <span className="t-num text-manila">{money(opened.totalValue as Cents)}</span>, from a
              product you paid <span className="t-num">{money(opened.paid as Cents)}</span> for.{" "}
              <span className={opened.totalValue >= opened.paid ? "text-gain" : "text-loss"}>
                {opened.totalValue >= opened.paid ? "Worth opening." : "Would have been better held."}
              </span>
            </p>
            <button
              type="button"
              onClick={() => setOpened(null)}
              className="text-manila-3 hover:text-manila mt-2 text-xs underline"
            >
              Dismiss
            </button>
          </div>
        )}

        <section className="mb-10">
          <h1 className="t-display mb-1 text-2xl tracking-tight">Sealed</h1>
          <p className="text-manila-2 mb-6 max-w-2xl text-sm">
            Sealed trades above the cards inside it, because supply only ever shrinks. Holding
            earns slowly and is not guaranteed. Opening gets you the cards now. That is the
            whole trade.
          </p>
          <p className="text-manila-3 mb-6 max-w-2xl text-xs">
            Expect variance. Most of a modern set&rsquo;s value sits in a handful of chase cards
            with a few percent pull rate, so a box that misses them is worth a fraction of its
            average — and one that hits is worth several times it.
          </p>

          {holdings.length > 0 && (
            <div className="mb-8">
              <h2 className="t-eyebrow text-manila-3 mb-3">
                Your holdings <span className="tabular-nums">{holdings.length}</span>
              </h2>
              <ul className="space-y-2">
                {holdings.map((h) => (
                  <li key={h.inventoryId} className="pane flex flex-wrap items-center gap-4 p-4">
                    {h.logoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={h.logoUrl} alt="" className="h-9 w-16 shrink-0 object-contain" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {h.setName} {h.label}
                      </p>
                      <p className="text-manila-3 text-[11px]">{h.packs} packs inside</p>
                    </div>
                    <div className="text-right">
                      <p className="t-eyebrow text-manila-3">Paid</p>
                      <p className="t-num tabular-nums">{money(h.paid as Cents)}</p>
                    </div>
                    <div className="text-right">
                      <p className="t-eyebrow text-manila-3">Offer</p>
                      <p className={cn("t-num tabular-nums", h.gain >= 0 ? "text-gain" : "text-loss")}>
                        {money(h.buyOffer as Cents)}
                      </p>
                      <p className={cn("text-[10px]", h.gain >= 0 ? "text-gain" : "text-loss")}>
                        {h.gain >= 0 ? "+" : "−"}
                        {money(Math.abs(h.gain) as Cents)}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => post("/api/sealed/sell", { inventoryId: h.inventoryId })}
                        className="ring-seam text-manila hover:ring-brass rounded-pane px-3 py-2 text-xs ring-1 transition disabled:opacity-40"
                      >
                        Sell sealed
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openIt(h)}
                        className="bg-brass text-ink hover:bg-brass-hot rounded-pane px-3 py-2 text-xs font-semibold transition disabled:opacity-40"
                      >
                        Open {h.packs}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h2 className="t-eyebrow text-manila-3">On the shelf</h2>
            <select
              value={setFilter}
              onChange={(e) => setSetFilter(e.target.value)}
              aria-label="Filter by set"
              className="bg-vitrine-3 ring-seam focus:ring-brass rounded-pane px-3 py-1.5 text-sm ring-1 outline-none"
            >
              <option value="">Newest sets</option>
              {sets.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((o) => {
              const affordable = effectiveCash !== null && effectiveCash >= o.price;
              return (
                <li key={o.productId} className="pane flex items-center gap-3 p-4">
                  {o.logoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={o.logoUrl} alt="" className="h-9 w-16 shrink-0 object-contain" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{o.label}</p>
                    <p className="text-manila-3 truncate text-[11px]">
                      {o.setName} · {o.packs} packs
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!affordable || busy}
                    onClick={() => post("/api/sealed/buy", { setId: o.setId, type: o.type })}
                    className={cn(
                      "shrink-0 rounded-pane px-3 py-2 text-xs font-semibold transition",
                      affordable
                        ? "bg-vitrine-3 text-manila hover:bg-brass hover:text-ink ring-seam ring-1"
                        : "text-manila-3 ring-seam cursor-not-allowed ring-1",
                    )}
                  >
                    {money(o.price as Cents)}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
  </>
  );
}
