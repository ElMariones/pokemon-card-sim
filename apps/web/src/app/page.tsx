"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { PackOpening, type OpeningView } from "@/components/PackOpening";
import { CardTile } from "@/components/CardTile";
import { CompletionBar } from "@/components/CompletionBar";
import { LevelBadge } from "@/components/LevelBadge";
import type { Cents } from "@pcs/shared";

interface Player { id: string; cash: Cents; xp: number; level: number }
interface SetRow {
  id: string; name: string; series: string; era: string; releaseDate: string;
  cardCount: number; pricedCount: number; avgPrice: number;
  logoUrl: string | null; symbolUrl: string | null; openable: boolean;
}
interface CollectionItem {
  inventoryId: string; cardId: string; name: string; number: string;
  rarityTier: string; imageSmall: string | null; marketBasePrice: number | null;
  condition: string | null; setName: string;
}

export default function Home() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [sets, setSets] = useState<SetRow[]>([]);
  const [opening, setOpening] = useState<OpeningView | null>(null);
  const [collection, setCollection] = useState<CollectionItem[]>([]);
  const [collectionTotal, setCollectionTotal] = useState(0);
  const [stats, setStats] = useState<{
    uniqueCards: number; totalCopies: number; portfolioValue: number;
    setsStarted: number; setsCompleted: number;
    bestCard: { name: string; value: number; imageSmall: string | null } | null;
  } | null>(null);
  const [prog, setProg] = useState<{
    level: number; title: string; progressBp: number; xpToNext: number | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"packs" | "collection">("packs");

  const loadCollection = useCallback(async () => {
    const res = await fetch("/api/collection?pageSize=24");
    if (!res.ok) return;
    const data = await res.json();
    setCollection(data.items ?? []);
    setCollectionTotal(data.total ?? 0);
    const s = await fetch("/api/collection/stats");
    if (s.ok) setStats(await s.json());
  }, []);

  useEffect(() => {
    (async () => {
      // /api/me establishes the session cookie, and every other endpoint
      // requires it. Fetching them in parallel raced on a first visit: the
      // player did not exist yet, so progression 401'd and the level badge
      // silently never appeared.
      const me = await fetch("/api/me").then((r) => r.json());
      setPlayer(me.player);

      const [s, p] = await Promise.all([
        fetch("/api/sets?limit=200").then((r) => r.json()),
        fetch("/api/progression").then((r) => (r.ok ? r.json() : null)),
      ]);
      if (p) setProg(p);
      setSets((s.sets ?? []).filter((x: SetRow) => x.openable));
      await loadCollection();
    })();
  }, [loadCollection]);

  const openPack = async (setId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/packs/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Could not open pack"); return; }
      setOpening(data);
      setPlayer((p) => (p ? { ...p, cash: data.balanceAfter } : p));
      void fetch("/api/progression").then(async (r) => { if (r.ok) setProg(await r.json()); });
    } finally {
      setBusy(false);
    }
  };

  const sell = async (inventoryId: string) => {
    const res = await fetch("/api/sell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inventoryId }),
    });
    if (!res.ok) return;
    const data = await res.json();
    setPlayer((p) => (p ? { ...p, cash: data.balanceAfter } : p));
    setOpening((o) =>
      o ? { ...o, cards: o.cards.filter((c) => c.inventoryId !== inventoryId) } : o,
    );
    await loadCollection();
  };

  return (
    <div className="vitrine-ambient min-h-full">
      <header className="border-seam/70 sticky top-0 z-20 border-b bg-ink/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-5 py-3.5">
          <div className="flex items-baseline gap-3">
            <span className="t-display text-[15px] tracking-tight">PokeCard</span>
            <span className="text-manila-3 hidden text-[11px] tracking-[0.2em] uppercase sm:inline">
              Collector Simulator
            </span>
          </div>
          <nav className="flex items-center gap-1" aria-label="Sections">
            {(["packs", "collection"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  "rounded-pane px-3 py-1.5 text-xs tracking-wide uppercase transition",
                  tab === t ? "bg-vitrine-3 text-manila" : "text-manila-3 hover:text-manila",
                )}
                aria-current={tab === t ? "page" : undefined}
              >
                {t}
                {t === "collection" && collectionTotal > 0 ? (
                  <span className="text-manila-3 ml-1.5 tabular-nums">{collectionTotal}</span>
                ) : null}
              </button>
            ))}
            {[
              { href: "/sealed", label: "Sealed" },
              { href: "/grading", label: "Grading" },
              { href: "/missions", label: "Missions" },
            ].map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-manila-3 hover:text-manila rounded-pane px-3 py-1.5 text-xs tracking-wide uppercase transition"
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-6">
            {prog && (
              <LevelBadge
                className="hidden sm:flex"
                level={prog.level}
                title={prog.title}
                progressBp={prog.progressBp}
                xpToNext={prog.xpToNext}
              />
            )}
            <div className="text-right">
              <p className="t-eyebrow text-manila-3">Cash</p>
              <p className="t-num text-brass tabular-nums">
                {player ? money(player.cash) : "—"}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-7xl px-5 py-8">
        {error && (
          <p role="alert" className="text-loss ring-loss/40 mb-6 rounded-pane px-4 py-3 text-sm ring-1">
            {error}
          </p>
        )}

        {opening ? (
          <PackOpening opening={opening} onDone={() => { setOpening(null); loadCollection(); }} onSell={sell} />
        ) : tab === "packs" ? (
          <>
            <div className="mb-6">
              <h1 className="t-display text-2xl tracking-tight">Choose a pack</h1>
              <p className="text-manila-2 mt-1 text-sm">
                {sets.length} sets priced and ready. Pack prices are derived from what the
                cards inside are actually worth today.
              </p>
            </div>

            {sets.length === 0 ? (
              <p className="text-manila-3 pane p-8 text-sm">
                No priced sets yet. Run <code className="t-mono">npm run data:prices</code> to
                import market prices.
              </p>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {sets.map((s) => (
                  <li key={s.id} className="pane flex items-center gap-4 p-4">
                    {s.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.logoUrl} alt="" className="h-12 w-20 shrink-0 object-contain" />
                    ) : (
                      <div className="bg-vitrine-3 h-12 w-20 shrink-0 rounded-slab" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{s.name}</p>
                      <p className="text-manila-3 text-[11px]">
                        {s.releaseDate.slice(0, 4)} · {s.cardCount} cards
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Link
                        href={`/set/${s.id}`}
                        className="text-manila-3 hover:text-brass rounded-pane px-2 py-2 text-xs tracking-wide uppercase transition"
                      >
                        Binder
                      </Link>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openPack(s.id)}
                        className="bg-vitrine-3 text-manila hover:bg-brass hover:text-ink ring-seam rounded-pane px-3 py-2 text-xs font-semibold ring-1 transition disabled:opacity-40"
                      >
                        Open
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <div className="mb-6">
              <h1 className="t-display text-2xl tracking-tight">Collection</h1>
              <p className="text-manila-2 mt-1 text-sm">
                {collectionTotal} card{collectionTotal === 1 ? "" : "s"} owned
                {collectionTotal > collection.length ? ` · showing ${collection.length}` : ""}
              </p>
            </div>

            {stats && (
              <dl className="pane mb-8 grid grid-cols-2 gap-6 p-5 sm:grid-cols-4">
                <div>
                  <dt className="t-eyebrow text-manila-3">Portfolio value</dt>
                  <dd className="t-num text-brass text-lg tabular-nums">
                    {money(stats.portfolioValue as Cents)}
                  </dd>
                </div>
                <div>
                  <dt className="t-eyebrow text-manila-3">Unique cards</dt>
                  <dd className="t-num text-lg tabular-nums">{stats.uniqueCards}</dd>
                </div>
                <div>
                  <dt className="t-eyebrow text-manila-3">Sets started</dt>
                  <dd className="t-num text-lg tabular-nums">{stats.setsStarted}</dd>
                </div>
                <div>
                  <dt className="t-eyebrow text-manila-3">Sets completed</dt>
                  <dd className="t-num text-lg tabular-nums">{stats.setsCompleted}</dd>
                </div>
              </dl>
            )}
            {collection.length === 0 ? (
              <p className="text-manila-3 pane p-8 text-sm">
                Nothing yet. Open a pack to start your collection.
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
                {collection.map((c) => (
                  <li key={c.inventoryId}>
                    <CardTile
                      name={c.name}
                      number={c.number}
                      rarityTier={c.rarityTier as never}
                      imageUrl={c.imageSmall}
                      condition={c.condition}
                      value={(c.marketBasePrice ?? 0) as Cents}
                      footer={
                        <button
                          type="button"
                          onClick={() => sell(c.inventoryId)}
                          className="text-manila-3 hover:text-brass mt-1 text-[11px] underline underline-offset-2"
                        >
                          Sell to dealer
                        </button>
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  );
}
