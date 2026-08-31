"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { rarityDisplay } from "@/lib/rarity-display";
import { CardTile } from "./CardTile";
import { RaritySymbol } from "./RaritySymbol";
import { REVEAL_PROFILE, CONFIDENCE_LABEL, type Cents, type RarityTier, type Confidence } from "@pcs/shared";

export interface OpenedCardView {
  cardId: string;
  inventoryId: string;
  name: string;
  number: string;
  rarityTier: RarityTier;
  imageSmall: string | null;
  imageLarge: string | null;
  slotName: string;
  isHit: boolean;
  isReverse: boolean;
  condition: string;
  value: Cents;
}

export interface OpeningView {
  openingId: string;
  setId?: string;
  setName: string;
  cost: Cents;
  totalValue: Cents;
  balanceAfter: Cents;
  seedHash: string;
  confidence: Confidence;
  cards: OpenedCardView[];
}

/**
 * How long each reveal holds before the next card is offered.
 *
 * Keyed by REVEAL_PROFILE, which is keyed by rarity tier — so adding a rarity
 * gives it pacing without touching this component (DESIGN.md section 31).
 */
const DWELL_MS: Record<(typeof REVEAL_PROFILE)[RarityTier], number> = {
  quick: 850,
  standard: 1300,
  shine: 1900,
  spectacle: 2800,
};

/**
 * With AnimatePresence mode="wait" the outgoing card must finish before the
 * incoming one starts, so every card spends EXIT + ENTER of its dwell in
 * motion. At the original 420ms quick dwell that was the entire time — commons
 * flickered past having never been fully opaque. Exit is kept short so the
 * card is settled and readable for most of its dwell.
 */
const EXIT_S = 0.16;
const ENTER_S = { quick: 0.3, standard: 0.34, shine: 0.45, spectacle: 0.7 } as const;

type Phase = "sealed" | "revealing" | "summary";

export function PackOpening({
  opening,
  onDone,
  onBack,
  onOpenAgain,
  canOpenAgain = true,
  busy = false,
  onSell,
}: {
  opening: OpeningView;
  onDone?: () => void;
  onBack?: () => void;
  onOpenAgain?: () => void;
  canOpenAgain?: boolean;
  busy?: boolean;
  onSell?: (inventoryId: string) => void;
}) {
  const handleBack = onBack ?? onDone ?? (() => {});
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("sealed");
  const [index, setIndex] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveRef = useRef<HTMLParagraphElement>(null);

  // Reset to sealed when a new pack is opened again (new openingId)
  useEffect(() => {
    setPhase("sealed");
    setIndex(-1);
    clearTimer();
  }, [opening.openingId]);

  const cards = opening.cards;
  const current = index >= 0 ? cards[index] : undefined;

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const skip = useCallback(() => {
    clearTimer();
    setIndex(cards.length);
  }, [cards.length]);

  /**
   * `index` is allowed to reach cards.length as an end sentinel, and the
   * transition to the summary happens in an effect below.
   *
   * The obvious version — calling setPhase from inside the setIndex updater —
   * is a side effect in a function React is free to invoke more than once, and
   * it left the reveal stuck on a card that never faded in.
   */
  const advance = useCallback(() => {
    clearTimer();
    setIndex((i) => Math.min(i + 1, cards.length));
  }, [cards.length]);

  useEffect(() => {
    if (index >= cards.length && phase === "revealing") setPhase("summary");
  }, [index, cards.length, phase]);

  // Auto-advance, paced by the current card's reveal profile.
  useEffect(() => {
    if (phase !== "revealing" || index < 0 || index >= cards.length) return;
    const card = cards[index]!;
    const dwell = reduceMotion ? 260 : DWELL_MS[REVEAL_PROFILE[card.rarityTier]];
    timer.current = setTimeout(advance, dwell);
    return clearTimer;
  }, [phase, index, cards, advance, reduceMotion]);

  // Announce each card for screen readers (DESIGN.md section 32).
  useEffect(() => {
    if (!current || !liveRef.current) return;
    const d = rarityDisplay(current.rarityTier);
    liveRef.current.textContent =
      `Card ${index + 1} of ${cards.length}: ${current.name}, ${d.label}` +
      `${current.isReverse ? ", reverse holo" : ""}, worth ${money(current.value)}. ${d.effect}.`;
  }, [current, index, cards.length]);

  // Keyboard: space/enter advances, escape skips.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); skip(); }
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (phase === "sealed") { setPhase("revealing"); setIndex(0); }
        else if (phase === "revealing") advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, advance, skip]);

  const best = useMemo(
    () => [...cards].sort((a, b) => b.value - a.value)[0],
    [cards],
  );
  const profit = opening.totalValue - opening.cost;

  return (
    <div className="relative flex min-h-[70vh] flex-col items-center justify-center">
      <p ref={liveRef} className="sr-only" role="status" aria-live="polite" />

      {/* Skip is available from the first frame, always. */}
      {phase !== "summary" && (
        <button
          type="button"
          onClick={skip}
          className="text-manila-2 hover:text-manila ring-seam hover:ring-seam-bright absolute top-0 right-0 rounded-pane px-3 py-2 text-xs tracking-wide uppercase ring-1 transition"
        >
          Skip reveal <kbd className="t-mono ml-1 opacity-60">Esc</kbd>
        </button>
      )}

      {phase === "sealed" && (
          <motion.div
            key="sealed"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.04 }}
            transition={{ duration: reduceMotion ? 0 : 0.35 }}
            className="flex flex-col items-center gap-6"
          >
            <button
              type="button"
              onClick={() => { setPhase("revealing"); setIndex(0); }}
              className="wrapper-mylar group relative aspect-[2.5/3.5] w-56 rounded-card ring-1 ring-seam focus-visible:outline-2 focus-visible:outline-brass"
              aria-label={`Open your ${opening.setName} pack`}
            >
              <span className="wrapper-crimp" aria-hidden />
              <span className="t-display absolute inset-x-0 bottom-8 text-center text-lg tracking-tight">
                {opening.setName}
              </span>
              <span className="text-manila-2 absolute inset-x-0 bottom-4 text-center text-[11px] tracking-[0.2em] uppercase">
                Tap to rip
              </span>
            </button>
            <p className="text-manila-3 text-xs">
              Press <kbd className="t-mono">Space</kbd> to open
            </p>
          </motion.div>
        )}

      {phase === "revealing" && current && (
          <motion.div key="revealing" className="flex w-full flex-col items-center gap-5">
            <AnimatePresence mode="wait" initial={false}>
              <RevealCard
                key={current.inventoryId}
                card={current}
                reduceMotion={!!reduceMotion}
                onAdvance={advance}
              />
            </AnimatePresence>
            <div className="flex items-center gap-2" aria-hidden>
              {cards.map((c, i) => (
                <span
                  key={c.inventoryId}
                  className={cn(
                    "h-1 rounded-full transition-all",
                    i < index ? "bg-manila-3 w-4" : i === index ? "bg-brass w-8" : "bg-seam w-4",
                  )}
                />
              ))}
            </div>
            <p className="text-manila-3 text-xs">
              {index + 1} of {cards.length} · click or press space to speed up
            </p>
          </motion.div>
        )}

      {phase === "summary" && (
          <motion.div
            key="summary"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.3 }}
            className="w-full"
          >
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleBack}
                className="ring-seam text-manila hover:ring-brass rounded-pane px-4 py-2 text-sm ring-1 transition"
              >
                ← Back
              </button>
              {onOpenAgain ? (
                <button
                  type="button"
                  onClick={onOpenAgain}
                  disabled={!canOpenAgain || busy}
                  title={!canOpenAgain ? "Not enough cash" : undefined}
                  className={cn(
                    "rounded-pane px-5 py-2.5 text-sm font-semibold transition",
                    canOpenAgain && !busy
                      ? "bg-brass text-ink hover:bg-brass-hot"
                      : "bg-vitrine-3 text-manila-3 cursor-not-allowed ring-seam ring-1",
                  )}
                >
                  {busy ? "Opening…" : `Open again · ${money(opening.cost)}`}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleBack}
                  className="bg-brass text-ink hover:bg-brass-hot rounded-pane px-5 py-2.5 text-sm font-semibold transition"
                >
                  Back to packs
                </button>
              )}
            </div>

            <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="t-eyebrow text-manila-3">{opening.setName}</p>
                <h2 className="t-display text-2xl">Pack results</h2>
              </div>
              <dl className="flex gap-6 text-right">
                <div>
                  <dt className="t-eyebrow text-manila-3">Cost</dt>
                  <dd className="t-num tabular-nums">{money(opening.cost)}</dd>
                </div>
                <div>
                  <dt className="t-eyebrow text-manila-3">Contents</dt>
                  <dd className="t-num tabular-nums">{money(opening.totalValue)}</dd>
                </div>
                <div>
                  <dt className="t-eyebrow text-manila-3">Result</dt>
                  <dd
                    className={cn(
                      "t-num tabular-nums",
                      profit >= 0 ? "text-gain" : "text-loss",
                    )}
                  >
                    {profit >= 0 ? "+" : "−"}
                    {money(Math.abs(profit) as Cents)}
                  </dd>
                </div>
              </dl>
            </header>

            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {cards.map((c) => (
                <li key={c.inventoryId}>
                  <CardTile
                    name={c.name}
                    number={c.number}
                    rarityTier={c.rarityTier}
                    imageUrl={c.imageSmall}
                    value={c.value}
                    condition={c.condition}
                    isReverse={c.isReverse}
                    footer={
                      onSell ? (
                        <button
                          type="button"
                          onClick={() => onSell(c.inventoryId)}
                          className="text-manila-3 hover:text-brass mt-1 text-[11px] underline underline-offset-2"
                        >
                          Sell to dealer
                        </button>
                      ) : null
                    }
                  />
                </li>
              ))}
            </ul>

            <footer className="border-seam mt-8 border-t pt-5">
              <p className="text-manila-3 max-w-lg text-[11px] leading-relaxed">
                {CONFIDENCE_LABEL[opening.confidence]} for this set.{" "}
                <span className="t-mono">seed {opening.seedHash.slice(0, 12)}…</span>
              </p>
            </footer>
          </motion.div>
      )}
    </div>
  );
}

function RevealCard({
  card,
  reduceMotion,
  onAdvance,
}: {
  card: OpenedCardView;
  reduceMotion: boolean;
  onAdvance: () => void;
}) {
  const d = rarityDisplay(card.rarityTier);
  const profile = REVEAL_PROFILE[card.rarityTier];
  const big = profile === "spectacle" || profile === "shine";

  return (
    <motion.button
      type="button"
      onClick={onAdvance}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 26, rotateY: -22, scale: 0.94 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, rotateY: 0, scale: big ? 1.04 : 1 }}
      exit={
        reduceMotion
          ? { opacity: 0, transition: { duration: 0 } }
          : { opacity: 0, y: -18, scale: 0.97, transition: { duration: EXIT_S } }
      }
      transition={{
        duration: reduceMotion ? 0.1 : ENTER_S[profile],
        ease: [0.16, 1, 0.3, 1],
      }}
      className={cn(
        "relative rounded-card focus-visible:outline-2 focus-visible:outline-brass",
        profile === "spectacle" && !reduceMotion && "animate-impact",
      )}
      aria-label={`${card.name}, ${d.label}. Click to continue.`}
    >
      <div className="w-52 sm:w-64">
        <CardTile
          name={card.name}
          number={card.number}
          rarityTier={card.rarityTier}
          imageUrl={card.imageLarge ?? card.imageSmall}
          value={card.value}
          isReverse={card.isReverse}
          priority
        />
      </div>

      {card.isHit && (
        <span
          className={cn(
            "bg-brass text-ink absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1",
            "text-[10px] font-bold tracking-[0.18em] uppercase",
          )}
        >
          <RaritySymbol tier={card.rarityTier} className="mr-1 -mt-0.5 inline h-3 w-3" title={false} />
          {d.label}
        </span>
      )}
    </motion.button>
  );
}
