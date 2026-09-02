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
let cachedSets: { value: SetRow[]; expiresAt: number } | null = null;
let setsRequest: Promise<SetRow[]> | null = null;

function loadOpenableSets(): Promise<SetRow[]> {
  if (cachedSets && cachedSets.expiresAt > Date.now()) return Promise.resolve(cachedSets.value);
  if (setsRequest) return setsRequest;

  setsRequest = fetch("/api/sets?limit=200")
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const value = (data?.sets ?? []).filter((set: SetRow) => set.openable) as SetRow[];
      cachedSets = { value, expiresAt: Date.now() + SETS_CACHE_MS };
      return value;
    })
    .finally(() => { setsRequest = null; });
  return setsRequest;
}

export default function PacksPage() {
  const { player, setCash, refresh } = usePlayer();
  const [sets, setSets] = useState<SetRow[]>([]);
  const [opening, setOpening] = useState<OpeningView | null>(null);
  const [packCount, setPackCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useQueryState("q", "");
  const [era, setEra] = useQueryState("era", "");
  const reduceMotion = useReducedMotion();
  usePreservedScroll();

  useEffect(() => {
    let mounted = true;
    void loadOpenableSets().then((sets) => { if (mounted) setSets(sets); });
    return () => { mounted = false; };
  }, []);

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
  }, [refresh]);

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

  const erasPresent = ERAS.filter((e) => sets.some((s) => s.era === e));

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
              {sets.length} sets priced and ready. A pack costs what the sealed pack trades
              for today — which is not the same as what the cards inside add up to.
            </p>
          </div>

          <div className="pane mb-6 flex flex-wrap items-center gap-2 p-3">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search sets…"
              aria-label="Search sets"
              className="bg-vitrine-3 ring-seam placeholder:text-manila-3 focus:ring-brass min-w-[13rem] flex-1 rounded-pane px-3 py-2 text-sm ring-1 outline-none"
            />
            <select
              aria-label="Filter by era"
              value={era}
              onChange={(e) => setEra(e.target.value)}
              className="bg-vitrine-3 ring-seam focus:ring-brass rounded-pane px-2.5 py-2 text-xs ring-1 outline-none"
            >
              <option value="">All eras</option>
              {erasPresent.map((e) => (
                <option key={e} value={e}>{ERA_LABEL[e]}</option>
              ))}
            </select>
            <span className="text-manila-3 text-xs tabular-nums">{visible.length} shown</span>
          </div>

          {visible.length === 0 ? (
            <p className="text-manila-3 pane p-8 text-sm">No sets match that.</p>
          ) : (
            <ul className="grid gap-5 lg:grid-cols-2">
              {visible.map((s) => (
                <PackShelfCard
                  key={s.id}
                  set={s}
                  cash={player?.cash ?? null}
                  busy={busy}
                  reduceMotion={!!reduceMotion}
                  onBuy={(setId, count) => void openPack(setId, count)}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
