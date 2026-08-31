"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { CompletionBar } from "@/components/CompletionBar";
import { RaritySymbol } from "@/components/RaritySymbol";
import { rarityDisplay } from "@/lib/rarity-display";
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
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [binder, setBinder] = useState<BinderCard[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/sets/${setId}?filter=${filter}`);
    if (res.ok) {
      const data = await res.json();
      setCompletion(data.completion);
      setBinder(data.binder ?? []);
    }
    setLoading(false);
  }, [setId, filter]);

  useEffect(() => { void load(); }, [load]);

  // Search is client-side because the binder for one set is at most a few
  // hundred rows and already in memory. The catalogue-wide search is server-side.
  const visible = search
    ? binder.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.number.toLowerCase().includes(search.toLowerCase()),
      )
    : binder;

  return (
    <div className="vitrine-ambient min-h-full">
      <header className="border-seam/70 sticky top-0 z-20 border-b bg-ink/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-5 py-3.5">
          <Link href="/" className="t-display text-[15px] tracking-tight hover:text-brass transition">
            PokeCard
          </Link>
          <span className="text-manila-3">/</span>
          <span className="text-manila-2 truncate text-sm">{completion?.setName ?? setId}</span>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-7xl px-5 py-8">
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
                  <BinderSlot card={c} />
                </li>
              ))}
            </ul>

            {!loading && visible.length === 0 && (
              <p className="text-manila-3 pane p-8 text-sm">Nothing matches that filter.</p>
            )}
          </>
        )}
      </main>
    </div>
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

function BinderSlot({ card }: { card: BinderCard }) {
  const owned = card.ownedCount > 0;
  const d = rarityDisplay(card.rarityTier);

  return (
    <div className="group">
      <div
        className={cn(
          "relative aspect-[2.5/3.5] overflow-hidden rounded-[8px] ring-1 transition",
          owned ? "ring-seam" : "ring-seam/40",
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
              owned ? "opacity-100" : "opacity-25 grayscale",
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
          <span className="absolute inset-0 flex items-center justify-center">
            <RaritySymbol tier={card.rarityTier} className="text-manila-3/60 h-4 w-4" />
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
    </div>
  );
}
