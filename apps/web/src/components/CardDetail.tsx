"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { money, relativeTime } from "@/lib/format";
import { rarityDisplay } from "@/lib/rarity-display";
import { CardFace } from "./CardFace";
import { GradedSlab } from "./GradedSlab";
import { RaritySymbol } from "./RaritySymbol";
import { PriceChart } from "./PriceChart";
import { CONFIDENCE_LABEL, type Cents, type Confidence, type RarityTier } from "@pcs/shared";

interface Copy {
  inventoryId: string;
  condition: string | null;
  acquiredAt: string;
  acquisitionPrice: number;
  status: string;
  grade: { company: string; numericGrade: number | null; label: string | null; status: string } | null;
  value: number;
  dealerOffer: number;
}

interface Detail {
  card: {
    id: string; name: string; number: string;
    rarityRaw: string | null; rarityTier: RarityTier;
    supertype: string | null; subtypes: string[]; types: string[];
    hp: string | null; artist: string | null;
    imageSmall: string | null; imageLarge: string | null;
    marketBasePrice: number; priceConfidence: Confidence;
    setId: string; setName: string; setSeries: string;
    releaseDate: string; setTotal: number; setSymbol: string | null;
  };
  history: { day: string; price: number }[];
  summary: { low: number; high: number; first: number; last: number; changeBp: number };
  copies: Copy[];
  owned: number;
}

/**
 * The enlarged card view.
 *
 * Reachable from anywhere a card appears, including a set checklist, so it has
 * to work for a card the player does not own — ownership is an extra section,
 * not a precondition.
 */
export function CardDetail({
  cardId,
  onClose,
  onChanged,
}: {
  cardId: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/cards/${encodeURIComponent(cardId)}`);
    if (res.ok) setData(await res.json());
  }, [cardId]);

  useEffect(() => { void load(); }, [load]);

  // Escape closes; focus moves into the dialog so the keyboard is not stranded
  // behind it, and the page underneath cannot be scrolled while it is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const act = async (path: string, body: object) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Something went wrong"); return; }
      await load();
      onChanged?.();
    } finally { setBusy(false); }
  };

  const card = data?.card;
  const d = card ? rarityDisplay(card.rarityTier) : null;
  const owned = data?.copies.filter((c) => c.status === "owned") ?? [];
  const inGrading = data?.copies.filter((c) => c.status === "grading") ?? [];
  const bestGraded = owned.find((c) => c.grade && c.grade.status === "completed");

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/85 p-4 backdrop-blur-sm sm:p-8"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={card ? `${card.name}, card details` : "Card details"}
        className="pane relative w-full max-w-4xl p-5 sm:p-7"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="text-manila-3 hover:text-manila ring-seam absolute top-4 right-4 z-20 rounded-pane px-2.5 py-1.5 text-xs uppercase ring-1 transition"
        >
          Close <kbd className="t-mono ml-1 opacity-60">Esc</kbd>
        </button>

        {!card ? (
          <p className="text-manila-3 py-16 text-center text-sm">Loading…</p>
        ) : (
          <div className="grid gap-7 lg:grid-cols-[300px_1fr]">
            <div>
              {bestGraded?.grade ? (
                <GradedSlab
                  grade={bestGraded.grade}
                  cardName={card.name}
                  setName={card.setName}
                  certSeed={bestGraded.inventoryId}
                >
                  <CardFace
                    name={card.name}
                    imageUrl={card.imageLarge ?? card.imageSmall}
                    rarityTier={card.rarityTier}
                    priority
                  />
                </GradedSlab>
              ) : (
                <CardFace
                  name={card.name}
                  imageUrl={card.imageLarge ?? card.imageSmall}
                  rarityTier={card.rarityTier}
                  priority
                />
              )}
              {bestGraded?.grade && (
                <p className="text-manila-3 mt-2 text-center text-[11px]">
                  Encapsulated by {bestGraded.grade.company}
                </p>
              )}
            </div>

            <div className="min-w-0">
              <p className="t-eyebrow text-manila-3">
                {card.setName} · #{card.number}
                {card.setTotal ? `/${card.setTotal}` : ""}
              </p>
              <h2 className="t-display mt-0.5 pr-24 text-2xl leading-tight tracking-tight">
                {card.name}
              </h2>

              <div className="text-manila-2 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                <span className="flex items-center gap-1.5">
                  <RaritySymbol tier={card.rarityTier} className="h-3 w-3" />
                  {card.rarityRaw ?? d!.label}
                </span>
                {card.hp && <span>{card.hp} HP</span>}
                {card.types.length > 0 && <span>{card.types.join(" / ")}</span>}
                {card.artist && <span className="text-manila-3">Illus. {card.artist}</span>}
              </div>

              <div className="border-seam mt-5 border-t pt-5">
                {card.marketBasePrice > 0 ? (
                  <PriceChart
                    points={data!.history}
                    low={data!.summary.low}
                    high={data!.summary.high}
                    changeBp={data!.summary.changeBp}
                  />
                ) : (
                  <p className="text-manila-3 text-xs">
                    {CONFIDENCE_LABEL[card.priceConfidence]}. No source covers this card, so it
                    has no price rather than an invented one.
                  </p>
                )}
              </div>

              <div className="border-seam mt-5 border-t pt-5">
                <p className="t-eyebrow text-manila-3 mb-2">
                  You own <span className="tabular-nums">{owned.length}</span>
                  {inGrading.length > 0 && (
                    <span className="text-manila-3"> · {inGrading.length} being graded</span>
                  )}
                </p>

                {owned.length === 0 && inGrading.length === 0 ? (
                  <p className="text-manila-3 text-xs">
                    Not in your collection yet.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {[...owned, ...inGrading].map((c) => (
                      <li
                        key={c.inventoryId}
                        className="ring-seam flex flex-wrap items-center gap-3 rounded-pane px-3 py-2 ring-1"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px]">
                            {c.grade && c.grade.status === "completed" ? (
                              <span className="text-brass font-semibold">
                                {c.grade.company} {c.grade.numericGrade}
                              </span>
                            ) : c.status === "grading" ? (
                              <span className="text-manila-2">Being graded</span>
                            ) : (
                              <span className="text-manila-2">
                                {(c.condition ?? "near mint").replace(/_/g, " ")}
                              </span>
                            )}
                          </p>
                          <p className="text-manila-3 t-mono text-[10px]">
                            {/* When a copy entered the collection. The exact
                                timestamp is on the title, so hovering gives the
                                precise moment without cluttering the row. */}
                            <time
                              dateTime={c.acquiredAt}
                              title={new Date(c.acquiredAt).toLocaleString()}
                            >
                              {relativeTime(c.acquiredAt)}
                            </time>
                            {" · "}
                            {c.acquisitionPrice > 0
                              ? `bought ${money(c.acquisitionPrice as Cents)}`
                              : "from a pack"}
                          </p>
                        </div>
                        <div className="text-right">
                          <p
                            className={cn(
                              "t-num text-[13px] tabular-nums",
                              c.grade?.status === "completed" && "text-brass",
                            )}
                          >
                            {money(c.value as Cents)}
                          </p>
                          <p className="text-manila-3 text-[10px]">
                            {/* The chart tracks the ungraded market price, so a
                                graded copy states both rather than looking
                                inconsistent with the number above it. */}
                            {c.grade?.status === "completed"
                              ? `raw ${money(card.marketBasePrice as Cents)} · dealer ${money(c.dealerOffer as Cents)}`
                              : `dealer ${money(c.dealerOffer as Cents)}`}
                          </p>
                        </div>
                        {c.status === "owned" && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => act("/api/sell", { inventoryId: c.inventoryId })}
                            className="ring-seam text-manila hover:ring-brass shrink-0 rounded-pane px-2.5 py-1.5 text-[11px] ring-1 transition disabled:opacity-40"
                          >
                            Sell
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {error && (
                  <p role="alert" className="text-loss mt-3 text-xs">{error}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
