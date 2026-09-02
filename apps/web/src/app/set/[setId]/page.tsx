"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { CompletionBar } from "@/components/CompletionBar";
import { RaritySymbol } from "@/components/RaritySymbol";
import { rarityDisplay } from "@/lib/rarity-display";
import { CardDetail } from "@/components/CardDetail";
import { PackOpening, type OpeningView } from "@/components/PackOpening";
import { usePlayer } from "@/components/PlayerProvider";
import { usePreservedScroll, useQueryState } from "@/lib/nav-state";
import type { Cents, RarityTier } from "@pcs/shared";

interface BinderCard {
  cardId: string; number: string; name: string; rarityTier: RarityTier;
  imageSmall: string | null; marketBasePrice: number | null;
  ownedCount: number; bestInventoryId: string | null; condition: string | null;
}
interface Completion {
  setId: string; setName: string; totalCards: number; ownedCards: number;
  ownedCopies: number; duplicates: number; completionBp: number;
  estimatedSetValue: number; ownedValue: number;
  byRarity: { rarityTier: RarityTier; total: number; owned: number }[];
}

type Filter = "all" | "owned" | "missing";

export default function SetPage({ params }: { params: Promise<{ setId: string }> }) {
  const { setId } = use(params);
  const { player, setCash, refresh } = usePlayer();
  usePreservedScroll();
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [binder, setBinder] = useState<BinderCard[]>([]);
  const [filter, setFilter] = useQueryState("filter", "all");
  const [search, setSearch] = useQueryState("q", "");
  const [packPrice, setPackPrice] = useState<number | null>(null);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [openedPack, setOpenedPack] = useState<OpeningView | null>(null);
  const [loading, setLoading] = useState(true);
  const [packError, setPackError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/sets/${setId}?filter=${filter}`);
    if (res.ok) {
      const data = await res.json();
      setCompletion(data.completion);
      setBinder(data.binder ?? []);
      setPackPrice(data.packPrice ?? null);
    }
    setLoading(false);
  }, [setId, filter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Search is client-side because the binder for one set is at most a few
  // hundred rows and already in memory. The catalogue-wide search is server-side.
  const visible = search
    ? binder.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.number.toLowerCase().includes(search.toLowerCase()),
      )
    : binder;

  const affordable = packPrice !== null && player !== null ? player.cash >= packPrice : true;

  /**
   * Buying from the binder goes through the same reveal as the shop. Quietly
   * adding the cards to the grid gave no sense of having opened anything.
   */
  const handleOpenPack = async () => {
    setOpening(true);
    setPackError(null);
    try {
      const res = await fetch("/api/packs/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setId }),
      });
      const data = await res.json();
      if (!res.ok) { setPackError(data.error ?? "Could not open pack"); return; }
      if (data.balanceAfter != null) setCash(data.balanceAfter);
      setOpenedPack({ ...data, setId: data.setId ?? setId });
    } finally { setOpening(false); }
  };

  /** Back from the reveal: the binder has changed, so reload it. */
  const handleRevealDone = useCallback(() => {
    setOpenedPack(null);
    void load();
    void refresh();
  }, [load, refresh]);

  const sellFromPack = async (inventoryId: string) => {
    const res = await fetch("/api/sell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inventoryId }),
    });
    if (!res.ok) return;
    const data = await res.json();
    setCash(data.balanceAfter);
    setOpenedPack((o) =>
      o ? { ...o, cards: o.cards.filter((c) => c.inventoryId !== inventoryId) } : o,
    );
  };

  if (openedPack) {
    return (
      <div className="mx-auto max-w-7xl px-5 py-8">
        <PackOpening
          opening={openedPack}
          onBack={handleRevealDone}
          onDone={handleRevealDone}
          onOpenAgain={() => { setOpenedPack(null); void handleOpenPack(); }}
          canOpenAgain={affordable}
          busy={opening}
          onSell={sellFromPack}
        />
      </div>
    );
  }

  return (
    <>

      <div className="mx-auto max-w-7xl px-5 py-8">
        {completion && (
          <>
            <div className="pane mb-8 grid gap-6 p-6 lg:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                <h1 className="t-display text-2xl tracking-tight">{completion.setName}</h1>
                <CompletionBar
                  className="mt-4 max-w-md"
                  bp={completion.completionBp}
                  owned={completion.ownedCards}
                  total={completion.totalCards}
                />
                <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
                  <Stat label="Copies held" value={String(completion.ownedCopies)} />
                  <Stat label="Duplicates" value={String(completion.duplicates)} />
                  <Stat label="Your value" value={money(completion.ownedValue as Cents)} />
                  <Stat
                    label="Full set value"
                    value={money(completion.estimatedSetValue as Cents)}
                  />
                </dl>
              </div>

              <div className="lg:w-56">
                {packPrice !== null && packPrice > 0 && (
                  <div className="border-seam mb-4 border-b pb-4">
                    <p className="t-eyebrow text-manila-3">Booster pack</p>
                    <p className="t-num text-brass text-lg tabular-nums">
                      {money(packPrice as Cents)}
                    </p>
                    {packError && (
                      <p role="alert" className="text-loss mt-2 text-xs">{packError}</p>
                    )}
                    <button
                      type="button"
                      disabled={opening || !affordable}
                      onClick={handleOpenPack}
                      title={!affordable ? "Not enough cash" : undefined}
                      className={cn(
                        "mt-2 w-full rounded-pane px-3 py-2 text-xs font-semibold transition disabled:opacity-40",
                        affordable
                          ? "bg-brass text-ink hover:bg-brass-hot"
                          : "bg-vitrine-3 text-manila-3 cursor-not-allowed ring-seam ring-1",
                      )}
                    >
                      {opening ? "Opening…" : affordable ? "Open a pack" : "Not enough cash"}
                    </button>
                  </div>
                )}
                <p className="t-eyebrow text-manila-3 mb-2">By rarity</p>
                <ul className="space-y-1.5">
                  {completion.byRarity.map((r) => (
                    <li key={r.rarityTier} className="flex items-center gap-2 text-[12px]">
                      <RaritySymbol tier={r.rarityTier} className="text-manila-2 h-3 w-3" />
                      <span className="text-manila-2 flex-1 truncate">
                        {rarityDisplay(r.rarityTier).label}
                      </span>
                      <span className="t-num tabular-nums">
                        <span className={r.owned >= r.total ? "text-brass" : "text-manila"}>
                          {r.owned}
                        </span>
                        <span className="text-manila-3">/{r.total}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mb-5 flex flex-wrap items-center gap-3">
              <div className="flex gap-1" role="group" aria-label="Filter binder">
                {(["all", "owned", "missing"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    aria-pressed={filter === f}
                    className={cn(
                      "rounded-pane px-3 py-1.5 text-xs tracking-wide uppercase transition",
                      filter === f
                        ? "bg-vitrine-3 text-manila"
                        : "text-manila-3 hover:text-manila",
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search this set…"
                aria-label="Search cards in this set"
                className="bg-vitrine-3 ring-seam placeholder:text-manila-3 focus:ring-brass min-w-[12rem] flex-1 rounded-pane px-3 py-1.5 text-sm ring-1 outline-none"
              />
              <span className="text-manila-3 text-xs tabular-nums">
                {visible.length} shown
              </span>
            </div>

            {/* The binder. Missing cards are rendered as empty slots, because a
                checklist that hides what you lack is not a checklist. */}
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8 xl:grid-cols-10">
              {visible.map((c) => (
                <li key={c.cardId}>
                  <BinderSlot card={c} onInspect={() => setInspecting(c.cardId)} />
                </li>
              ))}
            </ul>

            {!loading && visible.length === 0 && (
              <p className="text-manila-3 pane p-8 text-sm">Nothing matches that filter.</p>
            )}
          </>
        )}
      </div>

      {inspecting && (
        <CardDetail
          cardId={inspecting}
          onClose={() => setInspecting(null)}
          onChanged={() => { void load(); void refresh(); }}
        />
      )}
  </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="t-eyebrow text-manila-3">{label}</dt>
      <dd className="t-num tabular-nums">{value}</dd>
    </div>
  );
}

function BinderSlot({
  card,
  onInspect,
}: {
  card: BinderCard;
  onInspect: () => void;
}) {
  const owned = card.ownedCount > 0;
  const d = rarityDisplay(card.rarityTier);

  return (
    <button
      type="button"
      onClick={onInspect}
      className="group w-full text-left focus-visible:outline-2 focus-visible:outline-brass rounded-[8px]"
      aria-label={
        `${card.name}, number ${card.number}, ${d.label}. ` +
        `${owned ? `You own ${card.ownedCount}.` : "Not owned."} Inspect.`
      }
    >
      <div
        className={cn(
          "relative aspect-[2.5/3.5] overflow-hidden rounded-[8px] ring-1 transition duration-200",
          owned
            // Owned cards carry a warm ring and lift slightly, so a filled
            // page reads as filled at a glance without reading any labels.
            ? "ring-brass-dim/70 group-hover:ring-brass motion-safe:group-hover:-translate-y-0.5"
            : "ring-seam/50 group-hover:ring-seam-bright",
        )}
      >
        {card.imageSmall ? (
          <Image
            src={card.imageSmall}
            alt=""
            fill
            sizes="(max-width: 640px) 30vw, 120px"
            unoptimized
            loading="lazy"
            className={cn(
              "object-cover transition duration-300",
              // Missing cards are dimmed and desaturated rather than hidden, so
              // the shape of what is left to find stays visible at a glance.
              // They brighten on hover: the checklist is also where prices are
              // inspected, and a card too dark to read is no use for that.
              owned
                ? "opacity-100"
                : "opacity-40 grayscale-[0.9] group-hover:opacity-90 group-hover:grayscale-0",
            )}
          />
        ) : (
          <div className="bg-vitrine-2 h-full w-full" />
        )}

        {card.ownedCount > 1 && (
          <span className="bg-brass text-ink absolute top-1 right-1 rounded-full px-1.5 text-[10px] font-bold tabular-nums">
            ×{card.ownedCount}
          </span>
        )}
        {!owned && (
          <span
            className="bg-ink/70 absolute bottom-1 left-1 grid h-4 w-4 place-items-center rounded-full transition group-hover:opacity-0"
            title="Not owned"
          >
            <RaritySymbol tier={card.rarityTier} className="text-manila-2 h-2.5 w-2.5" />
          </span>
        )}
      </div>
      <p
        className={cn(
          "t-mono mt-1 truncate text-[10px]",
          owned ? "text-manila-2" : "text-manila-3",
        )}
        title={`${card.name} · ${d.label}${owned ? "" : " · not owned"}`}
      >
        #{card.number} {card.name}
      </p>
      {card.marketBasePrice != null && card.marketBasePrice > 0 && (
        <p
          className={cn(
            "t-num text-[10px] tabular-nums",
            owned ? "text-manila-2" : "text-manila-3",
          )}
        >
          {money(card.marketBasePrice as Cents)}
        </p>
      )}
    </button>
  );
}
