"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { PackOpening, type OpeningView } from "@/components/PackOpening";
import { usePlayer } from "@/components/PlayerProvider";
import { usePreservedScroll, useQueryState } from "@/lib/nav-state";
import { ERAS, type Cents } from "@pcs/shared";
import { ERA_LABEL } from "@pcs/card-data/era";

interface SetRow {
  id: string; name: string; series: string; era: string; releaseDate: string;
  cardCount: number; pricedCount: number; avgPrice: number;
  packPrice: number; packSize: number;
  logoUrl: string | null; symbolUrl: string | null; openable: boolean;
}

export default function PacksPage() {
  const { player, setCash, refresh } = usePlayer();
  const [sets, setSets] = useState<SetRow[]>([]);
  const [opening, setOpening] = useState<OpeningView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useQueryState("q", "");
  const [era, setEra] = useQueryState("era", "");
  usePreservedScroll();

  useEffect(() => {
    (async () => {
      const s = await fetch("/api/sets?limit=200").then((r) => (r.ok ? r.json() : null));
      if (s) setSets((s.sets ?? []).filter((x: SetRow) => x.openable));
    })();
  }, []);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return sets.filter(
      (s) =>
        (!era || s.era === era) &&
        (!term || s.name.toLowerCase().includes(term) || s.id.toLowerCase().includes(term)),
    );
  }, [sets, q, era]);

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
      // Ensure setId survives even if server shape changes
      if (!data.setId) data.setId = setId;
      setOpening(data);
      setCash(data.balanceAfter);
    } finally { setBusy(false); }
  };

  const handleOpenAgain = useCallback(() => {
    const sid = opening?.setId;
    if (!sid) { setError("Could not determine pack to reopen"); return; }
    void openPack(sid);
  }, [opening?.setId]);

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
              {sets.length} sets priced and ready. Pack prices come from what the cards inside
              are actually worth today.
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
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((s) => {
                const affordable = player === null || player.cash >= s.packPrice;
                return (
                  <li key={s.id} className="pane hover:ring-seam-bright flex items-center gap-4 p-4 transition">
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
                        {s.packSize > 0 ? ` · ${s.packSize} per pack` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Link
                        href={`/set/${s.id}`}
                        scroll={false}
                        className="text-manila-3 hover:text-brass rounded-pane px-2 py-2 text-xs tracking-wide uppercase transition"
                      >
                        Contents
                      </Link>
                      <button
                        type="button"
                        disabled={busy || !affordable}
                        onClick={() => openPack(s.id)}
                        className={cn(
                          "rounded-pane px-3 py-2 text-xs font-semibold tabular-nums transition",
                          affordable
                            ? "bg-vitrine-3 text-manila hover:bg-brass hover:text-ink ring-seam ring-1"
                            : "text-manila-3 ring-seam cursor-not-allowed ring-1",
                        )}
                        aria-label={`Open a ${s.name} pack for ${money(s.packPrice as Cents)}`}
                      >
                        {money(s.packPrice as Cents)}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
