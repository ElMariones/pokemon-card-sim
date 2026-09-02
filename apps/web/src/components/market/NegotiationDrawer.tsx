"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { money } from "@/lib/format";
import { cn } from "@/lib/cn";
import { CardFace } from "@/components/CardFace";
import { GradedSlab } from "@/components/GradedSlab";
import { usePlayer } from "@/components/PlayerProvider";
import { ModalPortal } from "@/components/ModalPortal";
import type { Cents } from "@pcs/shared";
import type { Dealer, NpcStock, TradeCard } from "./types";

interface Negotiation {
  id: string;
  stockId: string;
  anger: number;
  attempts: number;
  counterPrice: Cents;
  lastOffer: Cents | null;
  holdUntil: string;
}

function localRisk(offer: number, counter: number, anger: number) {
  const ratio = counter > 0 ? offer / counter : 1;
  if (ratio >= 0.94 && anger < 70) return "Comfortable";
  if (ratio >= 0.84 && anger < 80) return "Pushing it";
  if (ratio >= 0.6 && anger < 92) return "Risky";
  return "Insulting";
}

function holdLabel(until: string, now: number) {
  const seconds = Math.max(0, Math.ceil((new Date(until).getTime() - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function NegotiationDrawer({
  stock,
  dealer,
  onClose,
  onPurchased,
}: {
  stock: NpcStock;
  dealer: Dealer;
  onClose: () => void;
  onPurchased: () => void;
}) {
  const { player, setCash, refresh } = usePlayer();
  const [negotiation, setNegotiation] = useState<Negotiation | null>(null);
  const [trades, setTrades] = useState<TradeCard[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [offer, setOffer] = useState<number>(stock.askPrice);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [walked, setWalked] = useState(false);
  const [purchased, setPurchased] = useState(false);
  const [now, setNow] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/market/negotiate/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stockId: stock.id }),
      signal: controller.signal,
    }).then(async (response) => {
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Could not start this negotiation");
      setNegotiation(json.negotiation);
      setTrades(json.trades ?? []);
      setOffer(json.negotiation.counterPrice);
      setNow(new Date(json.negotiation.holdUntil).getTime() - 5 * 60 * 1_000);
    }).catch((cause) => {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Could not start this negotiation");
    });
    return () => controller.abort();
  }, [stock.id]);

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
      previousFocus.current?.focus();
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const selectedCards = useMemo(
    () => trades.filter((card) => selected.includes(card.inventoryId)),
    [selected, trades],
  );
  const tradeTotal = selectedCards.reduce((sum, card) => sum + card.credit, 0);
  const cashDue = Math.max(1, offer - tradeTotal);
  const risk = negotiation ? localRisk(offer, negotiation.counterPrice, negotiation.anger) : "Comfortable";
  const minimumOffer = negotiation ? Math.max(1, Math.round(negotiation.counterPrice * 0.45)) : 1;

  const close = useCallback(() => {
    if (negotiation && negotiation.attempts > 0 && !purchased && !walked
      && !window.confirm("Leave this negotiation? The card will go back on sale.")) return;
    if (negotiation && !purchased && !walked) {
      void fetch("/api/market/negotiate/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stockId: stock.id, negotiationId: negotiation.id }),
        keepalive: true,
      });
    }
    onClose();
  }, [negotiation, onClose, purchased, stock.id, walked]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { close(); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const toggleTrade = (card: TradeCard) => {
    setError(null);
    if (selected.includes(card.inventoryId)) {
      setSelected((current) => current.filter((id) => id !== card.inventoryId));
      return;
    }
    if (tradeTotal + card.credit >= offer) {
      setError("That card would overpay the offer. Raise the offer or choose a smaller trade.");
      return;
    }
    setSelected((current) => [...current, card.inventoryId]);
  };

  const submit = async (buyAtCounter = false) => {
    if (!negotiation) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const endpoint = buyAtCounter ? "/api/market/buy-now" : "/api/market/negotiate/offer";
      const body = buyAtCounter
        ? { stockId: stock.id, tradeInventoryIds: selected }
        : { stockId: stock.id, negotiationId: negotiation.id, totalOffer: offer, tradeInventoryIds: selected };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await response.json();
      if (!response.ok) { setError(json.error ?? "The deal could not be completed"); return; }
      if (json.purchased) {
        setPurchased(true);
        setCash(json.balanceAfter);
        setMessage(`Deal made. ${stock.name} is now in your collection.`);
        void refresh();
        return;
      }
      if (json.walked) {
        setWalked(true);
        setMessage(`${dealer.name} has ended the negotiation. This card is no longer available to you.`);
        return;
      }
      setNegotiation((current) => current ? {
        ...current,
        anger: json.anger,
        attempts: current.attempts + 1,
        counterPrice: json.counterPrice,
        lastOffer: offer as Cents,
        holdUntil: json.holdUntil,
      } : current);
      const tradesNoLongerFit = tradeTotal >= json.counterPrice;
      if (tradesNoLongerFit) setSelected([]);
      setOffer(tradesNoLongerFit
        ? Math.max(1, json.counterPrice - 1)
        : Math.max(tradeTotal + 1, json.counterPrice - 1, Math.round((offer + json.counterPrice) / 2)));
      setMessage(
        `${dealer.name} rejected the offer and moved to ${money(json.counterPrice as Cents)}.`
        + (tradesNoLongerFit ? " Your selected trades were cleared because their credit now exceeds the counter." : ""),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The deal could not be completed");
    } finally {
      setBusy(false);
    }
  };

  const anger = negotiation?.anger ?? 0;
  const visual = stock.grade ? (
    <GradedSlab grade={stock.grade} cardName={stock.name} setName={stock.setName} certSeed={stock.id}>
      <CardFace name={stock.name} imageUrl={stock.imageLarge ?? stock.imageSmall} rarityTier={stock.rarityTier} priority />
    </GradedSlab>
  ) : (
    <CardFace name={stock.name} imageUrl={stock.imageLarge ?? stock.imageSmall} rarityTier={stock.rarityTier} priority />
  );

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 bg-ink/78 backdrop-blur-sm" onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}>
        <section
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={`Negotiate with ${dealer.name} for ${stock.name}`}
          className="negotiation-drawer pane p-5 sm:p-7"
        >
          <div className="mb-5 flex items-center justify-between gap-4 border-b border-seam pb-4">
            <div>
              <p className="text-manila-3 text-xs">At {dealer.shopName}</p>
              <h2 className="t-display text-xl">Make a deal with {dealer.name}</h2>
            </div>
            <button ref={closeRef} type="button" onClick={close} className="ring-seam hover:ring-brass rounded-pane px-3 py-2 text-xs ring-1">
              Close <kbd className="t-mono ml-1 text-manila-3">Esc</kbd>
            </button>
          </div>

          <div className="grid gap-6 sm:grid-cols-[210px_1fr]">
            <div>
              {visual}
              <p className="mt-3 text-center text-xs text-manila-2">
                {stock.grade ? `${stock.grade.company} ${stock.grade.numericGrade}` : stock.conditionLabel}
                {" · "}{stock.setName}
              </p>
            </div>

            <div className="min-w-0">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="t-display text-2xl leading-tight">{stock.name}</h3>
                  <p className="mt-1 text-xs text-manila-3">#{stock.number} · Market estimate {money(stock.marketValue)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[11px] text-manila-3">Sticker</p>
                  <p className="t-num text-xl text-brass">{money(stock.askPrice)}</p>
                </div>
              </div>

              {!negotiation && !error && <p className="pane mt-5 p-4 text-sm text-manila-2">{dealer.name} is taking the card out of the case…</p>}

              {negotiation && !purchased && !walked && (
                <>
                  <div className="mt-5 rounded-pane bg-vitrine-3 p-4 ring-1 ring-seam">
                    <div className="mb-2 flex items-end justify-between gap-3">
                      <div>
                        <p className="text-[11px] text-manila-3">Your total offer</p>
                        <p className="t-num text-2xl">{money(offer as Cents)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] text-manila-3">Current counter</p>
                        <p className="t-num text-sm text-brass">{money(negotiation.counterPrice)}</p>
                      </div>
                    </div>
                    <input
                      aria-label="Total offer"
                      type="range"
                      min={minimumOffer}
                      max={negotiation.counterPrice}
                      step={Math.max(1, Math.round(negotiation.counterPrice / 200))}
                      value={Math.max(minimumOffer, Math.min(offer, negotiation.counterPrice))}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        setOffer(next <= tradeTotal ? tradeTotal + 1 : next);
                        setError(null);
                      }}
                      className="market-offer-slider w-full"
                    />
                    <div className="mt-3 flex items-center justify-between text-xs">
                      <span className={cn(
                        "font-medium",
                        risk === "Comfortable" && "text-gain",
                        risk === "Pushing it" && "text-brass",
                        (risk === "Risky" || risk === "Insulting") && "text-loss",
                      )}>{risk}</span>
                      <span className="t-mono text-manila-3">Held {holdLabel(negotiation.holdUntil, now)}</span>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="mb-1.5 flex justify-between text-xs">
                      <span className="text-manila-2">Seller patience</span>
                      <span className="t-mono text-manila-3">{anger}/100 anger</span>
                    </div>
                    <div className="anger-track h-2.5 overflow-hidden rounded-full bg-vitrine-3 ring-1 ring-seam" role="meter" aria-label="Seller anger" aria-valuemin={0} aria-valuemax={100} aria-valuenow={anger}>
                      <div className="anger-fill h-full rounded-full" style={{ width: `${anger}%`, ["--anger" as string]: anger }} />
                    </div>
                    <p className="mt-1.5 text-[11px] text-manila-3">
                      Ridiculously low or repeated offers make anger rise much faster.
                    </p>
                  </div>

                  <div className="mt-5 border-t border-seam pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold">Cards {dealer.name} wants</h4>
                        <p className="text-[11px] text-manila-3">Trade credit lowers the cash part of your offer.</p>
                      </div>
                      <span className="t-num text-sm text-brass">{money(tradeTotal as Cents)} credit</span>
                    </div>
                    {trades.length === 0 ? (
                      <p className="mt-3 rounded-pane bg-vitrine-3 p-3 text-xs text-manila-3">Nothing available in your collection matches this dealer’s interests.</p>
                    ) : (
                      <div className="mt-3 max-h-44 space-y-1.5 overflow-y-auto pr-1">
                        {trades.map((card) => {
                          const checked = selected.includes(card.inventoryId);
                          return (
                            <button
                              type="button"
                              key={card.inventoryId}
                              onClick={() => toggleTrade(card)}
                              aria-pressed={checked}
                              className={cn(
                                "flex min-h-14 w-full items-center gap-3 rounded-pane p-2 text-left ring-1 transition",
                                checked ? "bg-brass/10 ring-brass" : "bg-vitrine-3 ring-seam hover:ring-seam-bright",
                              )}
                            >
                              <div className="relative h-10 w-7 shrink-0 overflow-hidden rounded-[3px] bg-vitrine ring-1 ring-seam">
                                {card.imageSmall && <Image src={card.imageSmall} alt="" fill sizes="28px" unoptimized className="object-cover" />}
                              </div>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-medium">{card.name}</span>
                                <span className="block truncate text-[10px] text-manila-3">
                                  {card.exactWishlist ? "Exact wishlist · " : "Wanted · "}
                                  {card.grade ? `${card.grade.company} ${card.grade.numericGrade}` : card.condition.replaceAll("_", " ")}
                                  {card.favorite ? " · Favorite" : ""}
                                </span>
                              </span>
                              <span className="t-num shrink-0 text-xs text-brass">{money(card.credit)}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-3 border-t border-seam pt-4 text-sm">
                    <span className="text-manila-2">Trade credit</span><span className="t-num text-right">−{money(tradeTotal as Cents)}</span>
                    <span className="text-manila-2">Cash due</span><span className="t-num text-right text-brass">{money(cashDue as Cents)}</span>
                  </div>

                  {player && cashDue > player.cash && (
                    <p className="mt-3 text-xs text-loss">You need {money((cashDue - player.cash) as Cents)} more cash for this offer.</p>
                  )}
                  <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button type="button" onClick={close} disabled={busy} className="min-h-11 rounded-pane px-4 text-sm text-manila-2 hover:text-manila disabled:opacity-40">Walk away</button>
                    <button type="button" onClick={() => void submit(false)} disabled={busy || !negotiation || (player ? cashDue > player.cash : false)} className="min-h-11 rounded-pane px-4 text-sm font-semibold ring-1 ring-seam hover:ring-brass disabled:opacity-40">Make offer</button>
                    <button type="button" onClick={() => void submit(true)} disabled={busy || !negotiation || (player ? stock.askPrice - tradeTotal > player.cash : false) || tradeTotal >= stock.askPrice} className="min-h-11 rounded-pane bg-brass px-4 text-sm font-semibold text-ink hover:bg-brass-hot disabled:opacity-40">Pay sticker · {money(Math.max(1, stock.askPrice - tradeTotal) as Cents)}</button>
                  </div>
                </>
              )}

              {(message || error) && (
                <div aria-live="polite" role={error ? "alert" : "status"} className={cn("mt-5 rounded-pane p-4 text-sm ring-1", error ? "text-loss ring-loss/40" : purchased ? "deal-success text-gain ring-gain/40" : "text-manila-2 ring-seam")}>
                  {error ?? message}
                </div>
              )}
              {(purchased || walked) && (
                <button type="button" onClick={() => { onPurchased(); onClose(); }} className="mt-4 min-h-11 w-full rounded-pane bg-brass px-4 text-sm font-semibold text-ink hover:bg-brass-hot">
                  {purchased ? "See the refreshed case" : "Back to the dealer circuit"}
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}
