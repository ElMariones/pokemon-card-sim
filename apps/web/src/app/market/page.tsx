"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/cn";
import { money, relativeTime } from "@/lib/format";
import { usePlayer } from "@/components/PlayerProvider";
import { ListCardDialog } from "@/components/ListCardDialog";
import { usePreservedScroll } from "@/lib/nav-state";
import type { Cents } from "@pcs/shared";

interface Listing {
  id: string; inventoryItemId: string; cardId: string; name: string; number: string;
  rarityTier: string; imageSmall: string | null; setName: string;
  askPrice: number; marketValue: number; ratioBp: number;
  outlook: string; outlookLabel: string; expectedSeconds: number;
  visits: number; listedAt: string; dealerAlternative: number; netIfSold: number;
}
interface Sold {
  id: string; name: string; imageSmall: string | null;
  soldPrice: number; feePaid: number; netProceeds: number; marketValue: number;
  buyerName: string | null; buyerNote: string | null; soldAt: string; visits: number;
}

const OUTLOOK_TONE: Record<string, string> = {
  quick: "text-gain",
  fair: "text-manila",
  patient: "text-brass",
  slow: "text-loss",
  stale: "text-loss",
};

/** Rough wait, phrased as an estimate because that is what it is. */
function waitLabel(seconds: number): string {
  if (!Number.isFinite(seconds)) return "unlikely to sell";
  if (seconds < 120) return "about a minute";
  if (seconds < 3600) return `about ${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `about ${Math.round(seconds / 3600)} h`;
  return `about ${Math.round(seconds / 86_400)} days`;
}

export default function MarketPage() {
  const { refresh } = usePlayer();
  usePreservedScroll();
  const [active, setActive] = useState<Listing[]>([]);
  const [sold, setSold] = useState<Sold[]>([]);
  const [justSold, setJustSold] = useState<Sold[]>([]);
  const [listing, setListing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch("/api/market");
    if (res.ok) {
      const data = await res.json();
      setActive(data.active ?? []);
      setSold(data.sold ?? []);
      if (data.justSold?.length) {
        setJustSold(data.justSold);
        void refresh();
      }
    }
    setLoading(false);
  }, [refresh]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Buyers arrive on a timer, so the stall checks itself while it is open.
  useEffect(() => {
    if (active.length === 0) return;
    const t = setInterval(() => { void load(); }, 20_000);
    return () => clearInterval(t);
  }, [active.length, load]);

  const cancel = async (listingId: string) => {
    setError(null);
    const res = await fetch("/api/market/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listingId }),
    });
    if (!res.ok) { setError((await res.json()).error ?? "Could not cancel"); return; }
    await load();
  };

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="t-display text-2xl tracking-tight">Market stall</h1>
          <p className="text-manila-2 mt-1 max-w-2xl text-sm">
            The dealer pays instantly but keeps a wide spread. Here you set the price and
            wait for someone who wants it. Ask over market and it still sells — it just
            takes longer.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setListing(true)}
          className="bg-brass text-ink hover:bg-brass-hot rounded-pane px-4 py-2.5 text-sm font-semibold transition"
        >
          List a card
        </button>
      </div>

      {error && (
        <p role="alert" className="text-loss ring-loss/40 mb-6 rounded-pane px-4 py-3 text-sm ring-1">
          {error}
        </p>
      )}

      {justSold.length > 0 && (
        <div className="pane border-brass-dim mb-6 border p-4">
          <p className="t-eyebrow text-manila-3 mb-2">Sold while you were away</p>
          <ul className="space-y-1.5">
            {justSold.map((s) => (
              <li key={s.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="text-brass font-medium">{s.name}</span>
                <span className="text-manila-2">
                  to {s.buyerName} — {s.buyerNote}
                </span>
                <span className="t-num ml-auto tabular-nums">
                  {money(s.netProceeds as Cents)}
                  <span className="text-manila-3 ml-1 text-[11px]">
                    after {money(s.feePaid as Cents)} fee
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setJustSold([])}
            className="text-manila-3 hover:text-manila mt-2 text-xs underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <section className="mb-10">
        <h2 className="t-eyebrow text-manila-3 mb-3">
          On the table <span className="tabular-nums">{active.length}</span>
        </h2>

        {loading ? (
          <p className="text-manila-3 pane p-6 text-sm">Checking the stall…</p>
        ) : active.length === 0 ? (
          <p className="text-manila-3 pane p-8 text-sm">
            Nothing listed. Cards you put here sell for more than the dealer pays, if you
            are willing to wait.
          </p>
        ) : (
          <ul className="space-y-2">
            {active.map((l) => (
              <li key={l.id} className="pane flex flex-wrap items-center gap-4 p-3">
                <div className="ring-seam relative h-16 w-12 shrink-0 overflow-hidden rounded-[6px] ring-1">
                  {l.imageSmall && (
                    <Image src={l.imageSmall} alt="" fill sizes="48px" unoptimized className="object-cover" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{l.name}</p>
                  <p className="text-manila-3 text-[11px]">
                    {l.setName} · #{l.number} · listed {relativeTime(l.listedAt)}
                  </p>
                  <p className={cn("mt-0.5 text-[11px]", OUTLOOK_TONE[l.outlook] ?? "text-manila-2")}>
                    {l.outlookLabel} · ~{waitLabel(l.expectedSeconds)}
                    <span className="text-manila-3">
                      {" "}· {l.visits} {l.visits === 1 ? "visitor" : "visitors"} so far
                    </span>
                  </p>
                </div>

                <div className="text-right">
                  <p className="t-eyebrow text-manila-3">Asking</p>
                  <p className="t-num text-brass tabular-nums">{money(l.askPrice as Cents)}</p>
                  <p className="text-manila-3 text-[10px] tabular-nums">
                    {(l.ratioBp / 100).toFixed(0)}% of market
                  </p>
                </div>

                <div className="text-right">
                  <p className="t-eyebrow text-manila-3">You get</p>
                  <p className="t-num tabular-nums">{money(l.netIfSold as Cents)}</p>
                  <p className="text-manila-3 text-[10px] tabular-nums">
                    dealer {money(l.dealerAlternative as Cents)}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => cancel(l.id)}
                  className="text-manila-2 ring-seam hover:text-manila hover:ring-brass shrink-0 rounded-pane px-3 py-2 text-xs ring-1 transition"
                >
                  Take back
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {sold.length > 0 && (
        <section>
          <h2 className="t-eyebrow text-manila-3 mb-3">Recent sales</h2>
          <ul className="space-y-1.5">
            {sold.map((s) => (
              <li key={s.id} className="pane flex flex-wrap items-center gap-3 px-3 py-2">
                <div className="ring-seam relative h-10 w-7 shrink-0 overflow-hidden rounded-[4px] ring-1">
                  {s.imageSmall && (
                    <Image src={s.imageSmall} alt="" fill sizes="28px" unoptimized className="object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px]">{s.name}</p>
                  <p className="text-manila-3 text-[11px]">
                    {s.buyerName} · {s.buyerNote} · {relativeTime(s.soldAt)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="t-num text-gain text-[13px] tabular-nums">
                    {money(s.netProceeds as Cents)}
                  </p>
                  <p className="text-manila-3 text-[10px] tabular-nums">
                    asked {money(s.soldPrice as Cents)} · fee {money(s.feePaid as Cents)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {listing && (
        <ListCardDialog
          onClose={() => setListing(false)}
          onListed={() => { setListing(false); void load(); void refresh(); }}
        />
      )}
    </div>
  );
}
