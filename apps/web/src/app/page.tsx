"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { PackOpening, type OpeningView } from "@/components/PackOpening";
import { PackShelfCard, type ShelfSet } from "@/components/pack/PackShelfCard";
import { usePlayer } from "@/components/PlayerProvider";
import { usePreservedScroll, useQueryState } from "@/lib/nav-state";
import { ERAS } from "@pcs/shared";
import { ERA_LABEL } from "@pcs/card-data/era";

interface SetRow extends ShelfSet {
  series: string;
  openable: boolean;
}

const SETS_CACHE_MS = 5 * 60_000;
/** Shelf listings mounted before the player asks for more. */
const SHELF_PAGE = 24;

let cachedSets: { value: SetRow[]; expiresAt: number } | null = null;
let setsRequest: Promise<SetRow[]> | null = null;

/** The cached shelf if it is still fresh. Safe to read during render. */
function warmSets(): SetRow[] | null {
  return cachedSets && cachedSets.expiresAt > Date.now() ? cachedSets.value : null;
}

/**
 * Drop the cached shelf.
 *
 * Every row carries `ownedCards`, which is per-player and changes the instant a
 * pack is opened. The completion bar exists to answer "is another pack of this
 * set worth it", so the one player who must never see a five-minute-old answer
 * is the one who just changed it.
 */
function invalidateSets() {
  cachedSets = null;
}

function loadOpenableSets(): Promise<SetRow[]> {
  const warm = warmSets();
  if (warm) return Promise.resolve(warm);
  if (setsRequest) return setsRequest;

  setsRequest = fetch("/api/sets?limit=200")
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      // A failed request must not be cached as "no sets". Doing that left the
      // shop empty for the full five minutes after one blip, and refused to
      // retry even once the server was healthy again.
      if (!data?.sets) throw new Error("Could not load sets");
      const value = (data.sets as SetRow[]).filter((set) => set.openable);
      cachedSets = { value, expiresAt: Date.now() + SETS_CACHE_MS };
      return value;
    })
    .finally(() => { setsRequest = null; });
  return setsRequest;
}

export default function PacksPage() {
  const { player, setCash, refresh } = usePlayer();
  // Read the cache during the first render, not from an effect. A warm cache
  // resolves in a microtask, which is still a frame too late: the shelf painted
  // "No sets match that" before the packs it already had appeared.
  const [sets, setSets] = useState<SetRow[]>(() => warmSets() ?? []);
  const [loading, setLoading] = useState(() => warmSets() === null);
  const [opening, setOpening] = useState<OpeningView | null>(null);
  const [packCount, setPackCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useQueryState("q", "");
  const [era, setEra] = useQueryState("era", "");
  const [shown, setShown] = useState(SHELF_PAGE);
  const reduceMotion = useReducedMotion();
  usePreservedScroll();

  const reloadSets = useCallback(() => {
    let mounted = true;
    loadOpenableSets()
      .then((rows) => { if (mounted) { setSets(rows); setLoading(false); } })
      .catch(() => {
        if (!mounted) return;
        setLoading(false);
        setError("Could not load the shelf. Check your connection and try again.");
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => reloadSets(), [reloadSets]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return sets.filter(
      (s) =>
        (!era || s.era === era) &&
        (!term || s.name.toLowerCase().includes(term) || s.id.toLowerCase().includes(term)),
    );
  }, [sets, q, era]);

  const openPack = useCallback(async (setId: string, count = 1) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/packs/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setId, count }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Could not open pack"); return; }

      // A ten-pack comes back as a list of openings. They are shown as one
      // result: ten costs, ten piles of cards, one balance.
      const list: OpeningView[] = data.openings ?? [data];
      const merged: OpeningView = {
        ...list[0],
        setId: list[0].setId ?? setId,
        cost: list.reduce((sum, o) => sum + o.cost, 0) as OpeningView["cost"],
        totalValue: list.reduce((sum, o) => sum + o.totalValue, 0) as OpeningView["totalValue"],
        balanceAfter: list[list.length - 1].balanceAfter,
        cards: list.flatMap((o) => o.cards),
      };
      const src = sets.find((s) => s.id === setId);
      merged.logoUrl = merged.logoUrl ?? src?.logoUrl ?? null;
      merged.symbolUrl = merged.symbolUrl ?? src?.symbolUrl ?? null;

      // Ran out of cash partway through a ten-pack: keep what was opened and
      // say why the rest did not happen.
      if (data.error) setError(`${data.error} — opened ${list.length} of ${count}.`);

      setPackCount(list.length);
      setOpening(merged);
      setCash(merged.balanceAfter);
      // The shelf's "Collected" bars are now out of date by exactly this pull.
      invalidateSets();
    } finally { setBusy(false); }
  }, [sets, setCash]);

  const handleOpenAgain = useCallback(() => {
    const sid = opening?.setId;
    if (!sid) { setError("Could not determine pack to reopen"); return; }
    void openPack(sid, packCount);
  }, [opening?.setId, openPack, packCount]);

  const handleBack = useCallback(() => {
    setOpening(null);
    void refresh();
    reloadSets();
  }, [refresh, reloadSets]);

  const sell = async (inventoryId: string) => {
    const res = await fetch("/api/sell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inventoryId }),
    });
    if (!res.ok) return;
    const data = await res.json();
    setCash(data.balanceAfter);
    setOpening((o) =>
      o ? { ...o, cards: o.cards.filter((c) => c.inventoryId !== inventoryId) } : o,
    );
  };

  const erasPresent = useMemo(
    () => ERAS.filter((e) => sets.some((s) => s.era === e)),
    [sets],
  );

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      {error && (
        <p role="alert" className="text-loss ring-loss/40 mb-6 rounded-pane px-4 py-3 text-sm ring-1">
          {error}
        </p>
      )}

      {opening ? (
        <PackOpening
          opening={opening}
          packCount={packCount}
          onBack={handleBack}
          onOpenAgain={opening.setId ? handleOpenAgain : undefined}
          canOpenAgain={player ? player.cash >= opening.cost : false}
          busy={busy}
          onDone={handleBack}
          onSell={sell}
        />
      ) : (
        <>
          <div className="mb-6">
            <h1 className="t-display text-2xl tracking-tight">Choose a pack</h1>
            <p className="text-manila-2 mt-1 text-sm">
              {loading ? "Reading the shelf" : `${sets.length} sets priced and ready`}. A pack
              costs what the sealed pack trades for today — which is not the same as what the
              cards inside add up to.
            </p>
          </div>

          <div className="pane mb-6 flex flex-wrap items-center gap-2 p-3">
            <input
              type="search"
              value={q}
              onChange={(e) => { setQ(e.target.value); setShown(SHELF_PAGE); }}
              placeholder="Search sets…"
              aria-label="Search sets"
              className="bg-vitrine-3 ring-seam placeholder:text-manila-3 focus:ring-brass min-w-[13rem] flex-1 rounded-pane px-3 py-2 text-sm ring-1 outline-none"
            />
            <select
              aria-label="Filter by era"
              value={era}
              onChange={(e) => { setEra(e.target.value); setShown(SHELF_PAGE); }}
              className="bg-vitrine-3 ring-seam focus:ring-brass rounded-pane px-2.5 py-2 text-xs ring-1 outline-none"
            >
              <option value="">All eras</option>
              {erasPresent.map((e) => (
                <option key={e} value={e}>{ERA_LABEL[e]}</option>
              ))}
            </select>
            <span className="text-manila-3 text-xs tabular-nums">
              {loading ? "…" : `${visible.length} shown`}
            </span>
          </div>

          {loading ? (
            <ul className="grid gap-5 lg:grid-cols-2" aria-hidden>
              {Array.from({ length: 6 }, (_, i) => (
                <li key={i} className="pane shelf-skeleton h-[190px] p-5" />
              ))}
            </ul>
          ) : visible.length === 0 ? (
            <p className="text-manila-3 pane p-8 text-sm">No sets match that.</p>
          ) : (
            <>
              <ul className="grid gap-5 lg:grid-cols-2">
                {visible.slice(0, shown).map((s) => (
                  <PackShelfCard
                    key={s.id}
                    set={s}
                    cash={player?.cash ?? null}
                    busy={busy}
                    reduceMotion={!!reduceMotion}
                    onBuy={openPack}
                  />
                ))}
              </ul>
              {/* Mounting the whole shelf meant ~145 wrappers, ~20k DOM nodes
                  and a logo fetch each before the first pack was usable. */}
              {shown < visible.length && (
                <button
                  type="button"
                  onClick={() => setShown((n) => n + SHELF_PAGE)}
                  className="ring-seam text-manila-2 hover:text-manila hover:ring-brass mx-auto mt-6 block rounded-pane px-5 py-2.5 text-sm ring-1 transition"
                >
                  Show more — {visible.length - shown} left
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
