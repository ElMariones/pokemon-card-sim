"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { Search } from "lucide-react";
import { PackOpening, type OpeningView } from "@/components/PackOpening";
import { PackShelfCard, type ShelfSet } from "@/components/pack/PackShelfCard";
import { usePlayer } from "@/components/PlayerProvider";
import { money } from "@/lib/format";
import { usePreservedScroll, useQueryState } from "@/lib/nav-state";
import { ERAS, type Cents } from "@pcs/shared";
import { ERA_LABEL } from "@pcs/card-data/era";

interface SetRow extends ShelfSet {
  series: string;
  openable: boolean;
}

const SETS_CACHE_MS = 5 * 60_000;
/** Shelf listings mounted before the player asks for more. */
const SHELF_PAGE = 24;

/** How the shelf is ordered. Each answers a different shopping question. */
const SORTS = {
  newest: { label: "Newest", compare: (a: SetRow, b: SetRow) => b.releaseDate.localeCompare(a.releaseDate) },
  chase: { label: "Biggest pull", compare: (a: SetRow, b: SetRow) => (b.chase?.price ?? 0) - (a.chase?.price ?? 0) },
  cheapest: { label: "Cheapest", compare: (a: SetRow, b: SetRow) => a.packPrice - b.packPrice },
  progress: {
    label: "Closest to complete",
    compare: (a: SetRow, b: SetRow) =>
      (b.ownedCards ?? 0) / Math.max(b.cardCount, 1) - (a.ownedCards ?? 0) / Math.max(a.cardCount, 1),
  },
} as const;
type SortKey = keyof typeof SORTS;

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
  /** Which listing's purchase is in flight, so only its button says so. */
  const [pendingSetId, setPendingSetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useQueryState("q", "");
  const [era, setEra] = useQueryState("era", "");
  const [sort, setSort] = useQueryState("sort", "newest");
  const [shown, setShown] = useState(SHELF_PAGE);
  const reduceMotion = useReducedMotion();
  usePreservedScroll();

  const busy = pendingSetId !== null;

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
    // `in` walks the prototype chain, so ?sort=toString passed this guard and
    // resolved to Object.prototype.toString, whose .compare is undefined.
    const key: SortKey = Object.hasOwn(SORTS, sort) ? (sort as SortKey) : "newest";
    return sets
      .filter(
        (s) =>
          (!era || s.era === era) &&
          (!term || s.name.toLowerCase().includes(term) || s.id.toLowerCase().includes(term)),
      )
      .sort(SORTS[key].compare);
  }, [sets, q, era, sort]);

  const openPack = useCallback(async (setId: string, count = 1) => {
    setPendingSetId(setId);
    setError(null);
    try {
      const res = await fetch("/api/packs/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setId, count }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Could not open pack"); return; }

      // A multi-pack comes back as a list of openings. They are shown as one
      // result: N costs, N piles of cards, one balance.
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

      // Ran out of cash partway through the order: keep what was opened and
      // say why the rest did not happen.
      if (data.error) setError(`${data.error} — opened ${list.length} of ${count}.`);

      setPackCount(list.length);
      setOpening(merged);
      setCash(merged.balanceAfter);
      // The shelf's "Collected" bars are now out of date by exactly this pull.
      invalidateSets();
    } catch {
      setError("Could not reach the shop. Check your connection and try again.");
    } finally { setPendingSetId(null); }
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

  const cheapest = useMemo(
    () => (visible.length ? Math.min(...visible.map((s) => s.packPrice)) : 0),
    [visible],
  );

  if (opening) {
    return (
      <div className="mx-auto max-w-7xl px-5 py-8">
        {error && <Banner>{error}</Banner>}
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
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      {error && <Banner>{error}</Banner>}

      <header className="mb-6 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div>
          <h1 className="t-display text-2xl tracking-tight">Choose a pack</h1>
          <p className="text-manila-2 mt-1 max-w-xl text-sm">
            A pack costs what the sealed pack trades for today — not what the cards inside
            add up to. Pick a count, and the shop charges for each one separately.
          </p>
        </div>
        <dl className="flex shrink-0 gap-7">
          <div>
            <dt className="t-eyebrow">On the shelf</dt>
            <dd className="t-num mt-1 text-lg tabular-nums">
              {loading ? "—" : sets.length}
            </dd>
          </div>
          <div>
            <dt className="t-eyebrow">From</dt>
            <dd className="t-num text-brass mt-1 text-lg tabular-nums">
              {loading || !cheapest ? "—" : money(cheapest as Cents)}
            </dd>
          </div>
        </dl>
      </header>

      <div className="pane shelf-toolbar mb-5 flex flex-wrap items-center gap-2 p-3">
        <label className="relative w-full sm:w-auto sm:min-w-[13rem] sm:flex-1">
          <Search
            className="text-manila-3 pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
            aria-hidden
          />
          <input
            type="search"
            value={q}
            onChange={(e) => { setQ(e.target.value); setShown(SHELF_PAGE); }}
            placeholder="Search sets…"
            aria-label="Search sets"
            className="bg-vitrine-3 ring-seam placeholder:text-manila-3 focus:ring-brass w-full rounded-pane py-2 pr-3 pl-9 text-sm ring-1 outline-none"
          />
        </label>
        <select
          aria-label="Filter by era"
          value={era}
          onChange={(e) => { setEra(e.target.value); setShown(SHELF_PAGE); }}
          className="bg-vitrine-3 ring-seam focus:ring-brass min-w-0 flex-1 rounded-pane px-2.5 py-2 text-xs ring-1 outline-none sm:flex-none"
        >
          <option value="">All eras</option>
          {erasPresent.map((e) => (
            <option key={e} value={e}>{ERA_LABEL[e]}</option>
          ))}
        </select>
        <select
          aria-label="Sort the shelf"
          value={sort}
          onChange={(e) => { setSort(e.target.value); setShown(SHELF_PAGE); }}
          className="bg-vitrine-3 ring-seam focus:ring-brass min-w-0 flex-1 rounded-pane px-2.5 py-2 text-xs ring-1 outline-none sm:flex-none"
        >
          {Object.entries(SORTS).map(([key, s]) => (
            <option key={key} value={key}>{s.label}</option>
          ))}
        </select>
        <span className="text-manila-3 px-1 text-xs tabular-nums">
          {loading ? "…" : `${visible.length} shown`}
        </span>
      </div>

      {loading ? (
        <ul className="grid gap-4 lg:grid-cols-2" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="pane shelf-skeleton h-[266px] p-5" />
          ))}
        </ul>
      ) : visible.length === 0 ? (
        <div className="pane p-8">
          <p className="text-manila text-sm">No sets match that.</p>
          <button
            type="button"
            onClick={() => { setQ(""); setEra(""); }}
            className="text-brass hover:text-brass-hot mt-2 text-xs tracking-wide uppercase transition"
          >
            Clear the filters
          </button>
        </div>
      ) : (
        <>
          <ul className="grid gap-4 lg:grid-cols-2">
            {visible.slice(0, shown).map((s) => (
              <PackShelfCard
                key={s.id}
                set={s}
                cash={player?.cash ?? null}
                busy={busy}
                pending={pendingSetId === s.id}
                reduceMotion={!!reduceMotion}
                onBuy={openPack}
              />
            ))}
          </ul>
          {/* Mounting the whole shelf meant ~145 packs and a logo fetch each
              before the first one was usable. */}
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
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-loss ring-loss/40 mb-6 rounded-pane px-4 py-3 text-sm ring-1">
      {children}
    </p>
  );
}
