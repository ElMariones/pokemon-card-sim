"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import type { Cents } from "@pcs/shared";

interface OwnedCard {
  inventoryId: string; cardId: string; name: string; number: string;
  imageSmall: string | null; setName: string; value: number; condition: string | null;
}
interface Guide {
  marketValue: number;
  dealerOffer: number;
  points: {
    ratio: number; askPrice: number; net: number;
    outlook: string; expectedSeconds: number;
  }[];
}

const WAIT = (s: number) =>
  !Number.isFinite(s) ? "may not sell"
  : s < 120 ? "~1 min"
  : s < 3600 ? `~${Math.round(s / 60)} min`
  : s < 86_400 ? `~${Math.round(s / 3600)} h`
  : `~${Math.round(s / 86_400)} d`;

/**
 * Choose a card, then choose a price.
 *
 * The price step always shows what the dealer would pay right now next to what
 * the stall would net. The whole decision is that comparison, so it should not
 * require leaving the dialog to make it.
 */
export function ListCardDialog({
  onClose,
  onListed,
}: {
  onClose: () => void;
  onListed: () => void;
}) {
  const [owned, setOwned] = useState<OwnedCard[]>([]);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<OwnedCard | null>(null);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [ask, setAsk] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const loadOwned = useCallback(async () => {
    const p = new URLSearchParams({ sort: "price", dir: "desc", pageSize: "60" });
    if (q.trim()) p.set("q", q.trim());
    const res = await fetch(`/api/collection?${p}`);
    if (res.ok) setOwned((await res.json()).items ?? []);
  }, [q]);

  const opened = useRef(false);
  useEffect(() => {
    // The debounce belongs to typing, not to opening. Applying it to the first
    // load meant the dialog sat there saying "Nothing to list" for 220 ms plus
    // a round trip before the player's own cards appeared.
    if (!opened.current) {
      opened.current = true;
      void loadOwned();
      return;
    }
    const t = setTimeout(() => { void loadOwned(); }, 220);
    return () => clearTimeout(t);
  }, [loadOwned]);

  const pick = async (card: OwnedCard) => {
    setPicked(card);
    setError(null);
    const res = await fetch("/api/market/guide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inventoryItemId: card.inventoryId }),
    });
    if (!res.ok) { setError((await res.json()).error ?? "Cannot price that card"); return; }
    const g: Guide = await res.json();
    setGuide(g);
    setAsk(g.marketValue);
  };

  const submit = async () => {
    if (!picked) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/market/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inventoryItemId: picked.inventoryId, askPrice: Math.round(ask) }),
      });
      if (!res.ok) { setError((await res.json()).error ?? "Could not list"); return; }
      onListed();
    } finally { setBusy(false); }
  };

  const ratio = guide && guide.marketValue > 0 ? ask / guide.marketValue : 1;
  const net = Math.round(ask * 0.95);

  return (
    <div
      className="bg-ink/85 fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 backdrop-blur-sm sm:p-8"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="List a card on the market"
        className="pane relative w-full max-w-3xl p-5 sm:p-6"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="text-manila-3 hover:text-manila ring-seam absolute top-4 right-4 rounded-pane px-2.5 py-1.5 text-xs uppercase ring-1"
        >
          Close <kbd className="t-mono ml-1 opacity-60">Esc</kbd>
        </button>

        <h2 className="t-display mb-1 pr-24 text-lg tracking-tight">
          {picked ? "Set your price" : "Choose a card to sell"}
        </h2>

        {error && <p role="alert" className="text-loss mb-3 text-xs">{error}</p>}

        {!picked ? (
          <>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search your collection…"
              aria-label="Search your collection"
              className="bg-vitrine-3 ring-seam placeholder:text-manila-3 focus:ring-brass mt-3 mb-4 w-full rounded-pane px-3 py-2 text-sm ring-1 outline-none"
            />
            {owned.length === 0 ? (
              <p className="text-manila-3 py-8 text-center text-sm">Nothing to list.</p>
            ) : (
              <ul className="grid max-h-[52vh] grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-6">
                {owned.map((c) => (
                  <li key={c.inventoryId}>
                    <button
                      type="button"
                      onClick={() => pick(c)}
                      className="group focus-visible:outline-brass w-full text-left focus-visible:outline-2"
                    >
                      <div className="ring-seam group-hover:ring-brass relative aspect-[2.5/3.5] overflow-hidden rounded-[8px] ring-1 transition">
                        {c.imageSmall && (
                          <Image src={c.imageSmall} alt="" fill sizes="110px" unoptimized className="object-cover" />
                        )}
                      </div>
                      <p className="text-manila-2 mt-1 truncate text-[11px]">{c.name}</p>
                      <p className="t-num text-manila-3 text-[11px] tabular-nums">
                        {money(c.value as Cents)}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : guide ? (
          <div className="mt-3 flex flex-col gap-5 sm:flex-row">
            <div className="w-32 shrink-0">
              <div className="ring-brass relative aspect-[2.5/3.5] overflow-hidden rounded-[8px] ring-1">
                {picked.imageSmall && (
                  <Image src={picked.imageSmall} alt="" fill sizes="128px" unoptimized className="object-cover" />
                )}
              </div>
              <p className="mt-1.5 truncate text-[12px]">{picked.name}</p>
              <button
                type="button"
                onClick={() => { setPicked(null); setGuide(null); }}
                className="text-manila-3 hover:text-manila mt-1 text-[11px] underline"
              >
                Choose another
              </button>
            </div>

            <div className="min-w-0 flex-1">
              <div className="mb-4 flex flex-wrap gap-x-6 gap-y-2">
                <div>
                  <p className="t-eyebrow text-manila-3">Market value</p>
                  <p className="t-num tabular-nums">{money(guide.marketValue as Cents)}</p>
                </div>
                <div>
                  <p className="t-eyebrow text-manila-3">Dealer pays now</p>
                  <p className="t-num text-manila-2 tabular-nums">
                    {money(guide.dealerOffer as Cents)}
                  </p>
                </div>
                <div>
                  <p className="t-eyebrow text-manila-3">You would net</p>
                  <p className={cn(
                    "t-num tabular-nums",
                    net > guide.dealerOffer ? "text-gain" : "text-loss",
                  )}>
                    {money(net as Cents)}
                  </p>
                </div>
              </div>

              <label className="t-eyebrow text-manila-3 block" htmlFor="ask">
                Asking price — {(ratio * 100).toFixed(0)}% of market
              </label>
              <input
                id="ask"
                type="range"
                min={Math.max(1, Math.round(guide.marketValue * 0.5))}
                max={Math.round(guide.marketValue * 3)}
                step={1}
                value={ask}
                onChange={(e) => setAsk(Number(e.target.value))}
                className="accent-brass mt-2 w-full"
              />

              <div className="mt-3 flex flex-wrap gap-1.5">
                {guide.points.map((p) => (
                  <button
                    key={p.ratio}
                    type="button"
                    onClick={() => setAsk(p.askPrice)}
                    className={cn(
                      "rounded-pane px-2.5 py-1.5 text-[11px] ring-1 transition",
                      Math.abs(ask - p.askPrice) < 2
                        ? "bg-brass text-ink ring-brass font-semibold"
                        : "text-manila-2 ring-seam hover:text-manila",
                    )}
                  >
                    {Math.round(p.ratio * 100)}%
                    <span className="ml-1 opacity-70">{WAIT(p.expectedSeconds)}</span>
                  </button>
                ))}
              </div>

              <p className="text-manila-3 mt-3 text-[11px]">
                Wait times are estimates from the asking price and how sought-after the card
                is. A higher price always sells eventually — it just takes more visitors.
                The stall keeps 5% of the sale.
              </p>

              <button
                type="button"
                disabled={busy || ask < 1}
                onClick={submit}
                className="bg-brass text-ink hover:bg-brass-hot mt-4 rounded-pane px-4 py-2.5 text-sm font-semibold transition disabled:opacity-40"
              >
                {busy ? "Listing…" : `List for ${money(Math.round(ask) as Cents)}`}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-manila-3 py-8 text-center text-sm">Pricing…</p>
        )}
      </div>
    </div>
  );
}
