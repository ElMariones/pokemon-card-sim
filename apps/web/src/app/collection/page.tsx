"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { money, relativeTime } from "@/lib/format";
import { rarityDisplay } from "@/lib/rarity-display";
import { CardTile } from "@/components/CardTile";
import { CardDetail } from "@/components/CardDetail";
import { GradedSlab } from "@/components/GradedSlab";
import { RaritySymbol } from "@/components/RaritySymbol";
import { usePlayer } from "@/components/PlayerProvider";
import { RARITY_TIERS, CONDITION_LABEL, type Cents, type RarityTier } from "@pcs/shared";

interface Item {
  inventoryId: string; cardId: string; name: string; number: string;
  rarityTier: RarityTier; imageSmall: string | null;
  marketBasePrice: number | null; condition: string | null;
  acquiredAt: string; acquisitionPrice: number; acquisitionSource: string;
  favorite: boolean; setId: string; setName: string;
  grade: { company: string; numericGrade: number; label: string | null; isBlackLabel: boolean } | null;
  rawValue: number; value: number; dealerOffer: number;
}
interface Facets {
  sets: { setId: string; setName: string; n: number }[];
  rarities: { rarityTier: string; n: number }[];
  conditions: { condition: string; n: number }[];
  favorites: number;
}

const SORTS = [
  { id: "acquired", label: "Recently added" },
  { id: "price", label: "Value" },
  { id: "rarity", label: "Rarity" },
  { id: "condition", label: "Condition" },
  { id: "name", label: "Name" },
  { id: "set", label: "Set" },
] as const;

export default function CollectionPage() {
  const { refresh } = usePlayer();
  const [items, setItems] = useState<Item[]>([]);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [dupes, setDupes] = useState<{
    cardId: string; name: string; surplus: number; owned: number; surplusOffer: number;
  }[] | null>(null);
  const [dupeBusy, setDupeBusy] = useState(false);
  const [dupeResult, setDupeResult] = useState<{ soldCount: number; proceeds: number } | null>(null);

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [setId, setSetId] = useState("");
  const [rarity, setRarity] = useState("");
  const [condition, setCondition] = useState("");
  const [only, setOnly] = useState("");
  const [sort, setSort] = useState<string>("acquired");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  // Typing should not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q); setPage(1); }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const query = useMemo(() => {
    const p = new URLSearchParams({ sort, dir, page: String(page), pageSize: "48" });
    if (debouncedQ) p.set("q", debouncedQ);
    if (setId) p.set("setId", setId);
    if (rarity) p.set("rarity", rarity);
    if (condition) p.set("condition", condition);
    if (only) p.set("only", only);
    return p.toString();
  }, [debouncedQ, setId, rarity, condition, only, sort, dir, page]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/collection?${query}`);
    if (res.ok) {
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      setPageCount(data.pageCount ?? 1);
    }
    setLoading(false);
  }, [query]);

  const loadFacets = useCallback(async () => {
    const res = await fetch("/api/collection/facets");
    if (res.ok) setFacets(await res.json());
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadFacets(); }, [loadFacets]);

  const toggleFavorite = async (item: Item) => {
    // Optimistic: the star should respond instantly.
    setItems((prev) =>
      prev.map((i) => (i.inventoryId === item.inventoryId ? { ...i, favorite: !i.favorite } : i)),
    );
    const res = await fetch("/api/collection/favorite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inventoryId: item.inventoryId, favorite: !item.favorite }),
    });
    if (!res.ok) {
      setItems((prev) =>
        prev.map((i) => (i.inventoryId === item.inventoryId ? { ...i, favorite: item.favorite } : i)),
      );
      return;
    }
    void loadFacets();
  };

  const resetFilters = () => {
    setQ(""); setSetId(""); setRarity(""); setCondition(""); setOnly(""); setPage(1);
  };
  const filtered = Boolean(debouncedQ || setId || rarity || condition || only);

  const pageValue = items.reduce((a, i) => a + i.value, 0);

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="t-display text-2xl tracking-tight">Collection</h1>
          <p className="text-manila-2 mt-1 text-sm">
            {total.toLocaleString()} card{total === 1 ? "" : "s"}
            {filtered ? " matching" : " owned"}
            {items.length > 0 && (
              <span className="text-manila-3">
                {" "}· {money(pageValue as Cents)} on this page
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Filters in one row above the grid. */}
      <div className="pane mb-6 flex flex-wrap items-center gap-2 p-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or number…"
          aria-label="Search your collection"
          className="bg-vitrine-3 ring-seam placeholder:text-manila-3 focus:ring-brass min-w-[13rem] flex-1 rounded-pane px-3 py-2 text-sm ring-1 outline-none"
        />

        <Select
          label="Set"
          value={setId}
          onChange={(v) => { setSetId(v); setPage(1); }}
          options={[
            { value: "", label: "All sets" },
            ...(facets?.sets ?? []).map((s) => ({
              value: s.setId, label: `${s.setName} (${s.n})`,
            })),
          ]}
        />

        <Select
          label="Rarity"
          value={rarity}
          onChange={(v) => { setRarity(v); setPage(1); }}
          options={[
            { value: "", label: "Any rarity" },
            ...RARITY_TIERS.filter((t) =>
              (facets?.rarities ?? []).some((r) => r.rarityTier === t),
            ).map((t) => ({
              value: t,
              label: `${rarityDisplay(t).label} (${
                facets?.rarities.find((r) => r.rarityTier === t)?.n ?? 0
              })`,
            })),
          ]}
        />

        <Select
          label="Condition"
          value={condition}
          onChange={(v) => { setCondition(v); setPage(1); }}
          options={[
            { value: "", label: "Any condition" },
            ...(facets?.conditions ?? []).map((c) => ({
              value: c.condition,
              label: `${CONDITION_LABEL[c.condition as never] ?? c.condition} (${c.n})`,
            })),
          ]}
        />

        <div className="flex gap-1" role="group" aria-label="Quick filters">
          {[
            { id: "favorites", label: "★ Favourites" },
            { id: "graded", label: "Graded" },
            { id: "duplicates", label: "Duplicates" },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={only === f.id}
              onClick={() => { setOnly(only === f.id ? "" : f.id); setPage(1); }}
              className={cn(
                "rounded-pane px-2.5 py-2 text-xs transition",
                only === f.id
                  ? "bg-brass text-ink font-semibold"
                  : "text-manila-2 ring-seam hover:text-manila ring-1",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <Select
          label="Sort"
          value={sort}
          onChange={(v) => { setSort(v); setPage(1); }}
          options={SORTS.map((s) => ({ value: s.id, label: s.label }))}
        />
        <button
          type="button"
          onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))}
          aria-label={dir === "asc" ? "Sort ascending" : "Sort descending"}
          className="text-manila-2 ring-seam hover:text-manila rounded-pane px-2.5 py-2 text-xs ring-1"
        >
          {dir === "asc" ? "↑" : "↓"}
        </button>

        {filtered && (
          <button
            type="button"
            onClick={resetFilters}
            className="text-manila-3 hover:text-manila px-2 py-2 text-xs underline underline-offset-2"
          >
            Clear
          </button>
        )}
      </div>

      {only === "duplicates" && (
        <DuplicatesPanel
          dupes={dupes}
          busy={dupeBusy}
          result={dupeResult}
          onLoad={async () => {
            const res = await fetch("/api/collection/duplicates?keep=1");
            if (res.ok) setDupes((await res.json()).groups ?? []);
          }}
          onSellAll={async () => {
            setDupeBusy(true);
            try {
              const res = await fetch("/api/collection/duplicates", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ keep: 1 }),
              });
              if (res.ok) {
                const data = await res.json();
                setDupeResult({ soldCount: data.soldCount, proceeds: data.proceeds });
                setDupes(null);
                await load();
                await loadFacets();
                await refresh();
              }
            } finally { setDupeBusy(false); }
          }}
        />
      )}

      {loading && items.length === 0 ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <li key={i} className="bg-vitrine-2 aspect-[2.5/3.5] animate-pulse rounded-card" />
          ))}
        </ul>
      ) : items.length === 0 ? (
        <p className="text-manila-3 pane p-8 text-sm">
          {filtered ? "Nothing matches those filters." : "Nothing yet. Open a pack to start."}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {items.map((c) => (
            <li key={c.inventoryId} className="group/item relative">
              {c.grade ? (
                <button
                  type="button"
                  onClick={() => setInspecting(c.cardId)}
                  className="focus-visible:outline-brass w-full rounded-[10px] text-left focus-visible:outline-2"
                  aria-label={`${c.name}, graded ${c.grade.company} ${c.grade.numericGrade}. Inspect.`}
                >
                  <GradedSlab
                    compact
                    grade={c.grade}
                    cardName={c.name}
                    setName={c.setName}
                    certSeed={c.inventoryId}
                  >
                    {c.imageSmall && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.imageSmall}
                        alt=""
                        loading="lazy"
                        className="aspect-[2.5/3.5] w-full object-cover"
                      />
                    )}
                  </GradedSlab>
                  <Caption item={c} />
                </button>
              ) : (
                <>
                  <CardTile
                    name={c.name}
                    number={c.number}
                    rarityTier={c.rarityTier}
                    imageUrl={c.imageSmall}
                    condition={c.condition}
                    value={c.value as Cents}
                    onClick={() => setInspecting(c.cardId)}
                  />
                  <p className="text-manila-3 t-mono -mt-0.5 text-[10px]">
                    {relativeTime(c.acquiredAt)}
                  </p>
                </>
              )}

              <button
                type="button"
                onClick={() => toggleFavorite(c)}
                aria-pressed={c.favorite}
                aria-label={c.favorite ? `Remove ${c.name} from favourites` : `Add ${c.name} to favourites`}
                className={cn(
                  "absolute top-1.5 right-1.5 z-20 grid h-7 w-7 place-items-center rounded-full text-[13px] transition",
                  c.favorite
                    ? "bg-brass text-ink"
                    : "bg-ink/70 text-manila-3 hover:text-manila opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100",
                )}
              >
                ★
              </button>
            </li>
          ))}
        </ul>
      )}

      {pageCount > 1 && (
        <nav className="mt-8 flex items-center justify-center gap-2" aria-label="Pagination">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="text-manila-2 ring-seam hover:text-manila rounded-pane px-3 py-2 text-xs ring-1 disabled:opacity-30"
          >
            Previous
          </button>
          <span className="text-manila-3 t-mono px-2 text-xs tabular-nums">
            {page} / {pageCount}
          </span>
          <button
            type="button"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            className="text-manila-2 ring-seam hover:text-manila rounded-pane px-3 py-2 text-xs ring-1 disabled:opacity-30"
          >
            Next
          </button>
        </nav>
      )}

      {inspecting && (
        <CardDetail
          cardId={inspecting}
          onClose={() => setInspecting(null)}
          onChanged={() => { void load(); void loadFacets(); void refresh(); }}
        />
      )}
    </div>
  );
}

/**
 * Bulk-selling duplicates.
 *
 * "Keep one" is the only mode offered on purpose: the point of the feature is
 * clearing bulk without thinking about it, and a keep-count spinner turns a
 * one-click action into a decision. Favourited and graded copies are excluded
 * server-side, so nothing deliberately kept can be swept up by it.
 */
function DuplicatesPanel({
  dupes, busy, result, onLoad, onSellAll,
}: {
  dupes: { cardId: string; name: string; surplus: number; owned: number; surplusOffer: number }[] | null;
  busy: boolean;
  result: { soldCount: number; proceeds: number } | null;
  onLoad: () => Promise<void>;
  onSellAll: () => Promise<void>;
}) {
  useEffect(() => { if (dupes === null) void onLoad(); }, [dupes, onLoad]);

  const totalSurplus = (dupes ?? []).reduce((a, d) => a + d.surplus, 0);
  const totalOffer = (dupes ?? []).reduce((a, d) => a + d.surplusOffer, 0);

  if (result) {
    return (
      <div className="pane border-brass-dim mb-6 border p-4">
        <p className="text-sm">
          Sold <span className="t-num">{result.soldCount}</span> duplicate
          {result.soldCount === 1 ? "" : "s"} for{" "}
          <span className="t-num text-brass">{money(result.proceeds as Cents)}</span>.
        </p>
      </div>
    );
  }

  if (dupes === null) {
    return <p className="text-manila-3 pane mb-6 p-4 text-sm">Counting duplicates…</p>;
  }

  if (totalSurplus === 0) {
    return (
      <p className="text-manila-3 pane mb-6 p-4 text-sm">
        No spare copies. Favourited and graded cards are never counted as duplicates.
      </p>
    );
  }

  return (
    <div className="pane mb-6 flex flex-wrap items-center gap-4 p-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className="t-num">{totalSurplus}</span> spare cop
          {totalSurplus === 1 ? "y" : "ies"} across{" "}
          <span className="t-num">{dupes.length}</span> card
          {dupes.length === 1 ? "" : "s"}, keeping one of each.
        </p>
        <p className="text-manila-3 mt-0.5 text-[11px]">
          Favourited and graded copies are excluded. The dealer pays{" "}
          {money(totalOffer as Cents)} for the lot — the market stall would pay more,
          but one card at a time.
        </p>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={onSellAll}
        className="bg-brass text-ink hover:bg-brass-hot shrink-0 rounded-pane px-4 py-2.5 text-sm font-semibold transition disabled:opacity-40"
      >
        {busy ? "Selling…" : `Sell all for ${money(totalOffer as Cents)}`}
      </button>
    </div>
  );
}

function Caption({ item }: { item: Item }) {
  return (
    <>
      <p className="mt-1.5 truncate text-[12px] font-medium">{item.name}</p>
      <p className="t-num text-brass text-[12px] tabular-nums">
        {money(item.value as Cents)}
        <span className="text-manila-3 ml-1 text-[10px]">
          raw {money(item.rawValue as Cents)}
        </span>
      </p>
      <p className="text-manila-3 t-mono text-[10px]">{relativeTime(item.acquiredAt)}</p>
    </>
  );
}

function Select({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-vitrine-3 ring-seam focus:ring-brass max-w-[13rem] rounded-pane px-2.5 py-2 text-xs ring-1 outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
