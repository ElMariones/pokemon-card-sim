"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { rarityDisplay } from "@/lib/rarity-display";
import { CardTile } from "./CardTile";
import { RaritySymbol } from "./RaritySymbol";
import SlidingCards from "./lightswind/sliding-cards";
import { GlassSurface } from "./GlassSurface";
import { PackWrapper } from "./pack/PackWrapper";
import { CONFIDENCE_LABEL, type Cents, type RarityTier, type Confidence } from "@pcs/shared";

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
  isNew: boolean;
  condition: string;
  value: Cents;
}

export interface OpeningView {
  openingId: string;
  setId?: string;
  setName: string;
  logoUrl?: string | null;
  symbolUrl?: string | null;
  cost: Cents;
  totalValue: Cents;
  balanceAfter: Cents;
  seedHash: string;
  confidence: Confidence;
  cards: OpenedCardView[];
}

type Phase = "sealed" | "tearing" | "revealing" | "summary";

type PackOpeningProps = {
  opening: OpeningView;
  /**
   * How many packs this result covers. A ten-pack goes straight to the
   * results: ninety cards turned one at a time is a chore, not a reveal.
   */
  packCount?: number;
  onDone?: () => void;
  onBack?: () => void;
  onOpenAgain?: () => void;
  canOpenAgain?: boolean;
  busy?: boolean;
  onSell?: (inventoryId: string) => void;
};

export function PackOpening(props: PackOpeningProps) {
  // A new opening is a new interaction session. Remounting avoids resetting
  // state from an effect, which briefly showed stale cards for a new pack.
  return <PackOpeningSession key={props.opening.openingId} {...props} />;
}

function PackOpeningSession({
  opening,
  packCount = 1,
  onDone,
  onBack,
  onOpenAgain,
  canOpenAgain = true,
  busy = false,
  onSell,
}: PackOpeningProps) {
  const handleBack = onBack ?? onDone ?? (() => {});
  const reduceMotion = useReducedMotion();
  const bundle = packCount > 1;
  const [phase, setPhase] = useState<Phase>(bundle ? "summary" : "sealed");
  const [index, setIndex] = useState(-1);
  const [faceUpIndex, setFaceUpIndex] = useState(-1);
  // Which card is showing its artwork. Reported by the card itself, so the
  // label can never appear over a face-down card. Storing the card rather than
  // a boolean means turning to the next card resets it by construction.
  const [faceUpCard, setFaceUpCard] = useState<string | number | null>(null);
  const liveRef = useRef<HTMLParagraphElement>(null);

  const cards = opening.cards;
  const current = index >= 0 ? cards[index] : undefined;
  const frontVisible = faceUpCard !== null && faceUpCard === current?.inventoryId;

  /**
   * Only the card currently on top may drive the label. A departing card
   * unmounts after its flight, so without this guard its final report lands
   * after the next card has been turned and hides that card's label.
   */
  const handleFaceChange = useCallback(
    (faceUp: boolean, cardId: string | number) => {
      if (cardId !== current?.inventoryId) return;
      setFaceUpCard(faceUp ? cardId : null);
    },
    [current?.inventoryId],
  );

  const skip = useCallback(() => {
    setIndex(cards.length);
    setPhase("summary");
  }, [cards.length]);

  /**
   * A card takes about a third of a second to fly out and the next one to
   * settle. Without a lock a second click inside that window is applied to a
   * state that is still changing, and one tap both dismissed a card and turned
   * over its replacement — so a card appeared already face-up.
   */
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    if (!locked) return;
    const t = window.setTimeout(() => setLocked(false), 380);
    return () => window.clearTimeout(t);
  }, [locked]);

  const advance = useCallback(() => {
    if (locked) return;
    setLocked(true);
    setFrontVisible(false);
    if (index >= cards.length - 1) {
      setIndex(cards.length);
      setPhase("summary");
      return;
    }
    setIndex((i) => i + 1);
  }, [cards.length, index, locked]);

  const reveal = useCallback(() => {
    if (locked) return;
    setFaceUpIndex(index);
  }, [index, locked]);

  const revealOrAdvance = useCallback(() => {
    if (locked) return;
    if (faceUpIndex !== index) {
      reveal();
      return;
    }
    advance();
  }, [advance, faceUpIndex, index, locked, reveal]);

  const startTear = useCallback(() => {
    if (phase !== "sealed") return;
    if (reduceMotion) {
      setPhase("revealing");
      setIndex(0);
      return;
    }
    setPhase("tearing");
  }, [phase, reduceMotion]);

  useEffect(() => {
    if (phase !== "tearing") return;
    // Long enough for the strip to actually leave the wrapper and for the
    // recoil to settle. At 620ms the tear was over before it registered.
    const timeout = window.setTimeout(() => {
      setPhase("revealing");
      setIndex(0);
    }, 1150);
    return () => window.clearTimeout(timeout);
  }, [phase]);

  useEffect(() => {
    if (!current || !liveRef.current) return;
    const d = rarityDisplay(current.rarityTier);
    liveRef.current.textContent =
      `Card ${index + 1} of ${cards.length}: ${current.name}, ${d.label}` +
      `${current.isReverse ? ", reverse holo" : ""}, worth ${money(current.value)}. ${d.effect}.`;
  }, [current, index, cards.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); skip(); }
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (phase === "sealed") startTear();
        else if (phase === "tearing") { /* wait for animation */ }
        else if (phase === "revealing") revealOrAdvance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, revealOrAdvance, skip, startTear]);

  const profit = opening.totalValue - opening.cost;

  const slidingData = useMemo(
    () =>
      cards.map((c) => ({
        id: c.inventoryId,
        imageUrl: c.imageLarge ?? c.imageSmall,
        name: c.name,
        number: c.number,
        isHit: c.isHit,
        isNew: c.isNew,
        isReverse: c.isReverse,
        rarityTier: c.rarityTier,
        bgClass: c.isHit
          ? "bg-gradient-to-br from-brass via-amber-500 to-yellow-700"
          : c.isReverse
            ? "bg-gradient-to-br from-violet-600 to-indigo-800"
            : "bg-gradient-to-br from-vitrine-2 to-vitrine-3",
      })),
    [cards],
  );

  return (
    <div className="relative flex min-h-[70vh] flex-col items-center justify-center">
      <p ref={liveRef} className="sr-only" role="status" aria-live="polite" />

      {phase !== "summary" && (
        <button
          type="button"
          onClick={skip}
          className="text-manila-2 hover:text-manila ring-seam hover:ring-seam-bright absolute top-0 right-0 rounded-pane px-3 py-2 text-xs tracking-wide uppercase ring-1 transition"
        >
          Skip reveal <kbd className="t-mono ml-1 opacity-60">Esc</kbd>
        </button>
      )}

      {(phase === "sealed" || phase === "tearing") && (
        <motion.div
          key="wrapper"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.04 }}
          transition={{ duration: reduceMotion ? 0 : 0.35 }}
          className="flex flex-col items-center gap-6"
        >
          {/* One wrapper across both phases. Rendering a second one for the
              tear remounted the element, and a remounted layer starts at its
              target transform — the strip vanished instead of coming off. */}
          <BoosterPack
            setId={opening.setId}
            setName={opening.setName}
            logoUrl={opening.logoUrl ?? null}
            symbolUrl={opening.symbolUrl ?? null}
            reduceMotion={!!reduceMotion}
            phase={phase}
            onRip={startTear}
          />
          {phase === "sealed" ? (
            <p className="text-manila-3 text-xs">
              Press <kbd className="t-mono">Space</kbd> or click pack to rip
            </p>
          ) : (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-brass text-xs tracking-wide uppercase"
            >
              Ripping…
            </motion.p>
          )}
        </motion.div>
      )}

      {phase === "revealing" && (
        <motion.div key="revealing" className="flex w-full flex-col items-center gap-6">
          {/* opened pack stays behind */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 0.32, y: 0, scale: 0.86 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className="pointer-events-none absolute top-[4%] left-1/2 hidden -translate-x-1/2 sm:block"
            aria-hidden
          >
            <div className="relative w-36 opacity-30">
              <BoosterPack
                setId={opening.setId}
                setName={opening.setName}
                logoUrl={opening.logoUrl ?? null}
                symbolUrl={opening.symbolUrl ?? null}
                reduceMotion={!!reduceMotion}
                phase="open"
                onRip={() => {}}
                compact
              />
              <div className="absolute -top-1 inset-x-6 h-2 rounded-full bg-ink blur-[1px]" />
            </div>
          </motion.div>

          {/* Lightswind Sliding Cards — interactive 3D stack */}
          <div className="relative">
            <SlidingCards
              cards={slidingData}
              activeIndex={index}
              revealed={faceUpIndex === index}
              onFaceChange={handleFaceChange}
              className="w-[300px] h-[420px] sm:w-[340px] sm:h-[480px]"
              onReveal={reveal}
              onAdvance={advance}
            />
            {/* current card meta overlay */}
            {current && frontVisible && (
              <motion.div
                key={current.inventoryId + "-meta"}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className="pointer-events-none absolute -bottom-3 left-1/2 z-[220] -translate-x-1/2"
              >
                <GlassSurface className="relative z-[220] flex min-w-max items-center gap-2 rounded-full px-3 py-2">
                  <RaritySymbol tier={current.rarityTier} className="h-3 w-3 text-brass" />
                  <span className="text-xs font-semibold text-white">{current.name}</span>
                  <span className="text-manila-2 text-[11px]">#{current.number}</span>
                  <span className="t-num ml-1 text-xs tabular-nums text-brass-hot">{money(current.value)}</span>
                  {current.isHit && <span className="bg-brass text-ink rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase">Hit</span>}
                </GlassSurface>
              </motion.div>
            )}
          </div>

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
          <p className="text-manila-3 text-center text-xs">
            {index >= 0 ? `${Math.min(index + 1, cards.length)} of ${cards.length}` : `Swipe or drag the stack • ${cards.length} cards`}
            <br />
            <span className="opacity-70">Tap or drag to turn it over • move a face-up card aside</span>
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={revealOrAdvance}
              className="ring-seam text-manila hover:ring-brass rounded-pane px-4 py-2 text-xs ring-1 transition"
            >
              Next
            </button>
            <button
              type="button"
              onClick={skip}
              className="bg-brass text-ink hover:bg-brass-hot rounded-pane px-5 py-2 text-xs font-semibold transition"
            >
              View results
            </button>
          </div>
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
                {busy
                  ? "Opening…"
                  : bundle
                    ? `Open ${packCount} more · ${money(opening.cost)}`
                    : `Open again · ${money(opening.cost)}`}
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
              <h2 className="t-display text-2xl">
                {bundle ? `${packCount} packs opened` : "Pack results"}
              </h2>
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

          {/* staggered entrance for the grid */}
          <motion.ul
            initial="hidden"
            animate="visible"
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.06 } },
            }}
            className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6"
          >
            {cards.map((c) => (
              <motion.li
                key={c.inventoryId}
                variants={{
                  hidden: { opacity: 0, y: 14 },
                  visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 380, damping: 24 } },
                }}
              >
                <CardTile
                  name={c.name}
                  number={c.number}
                  rarityTier={c.rarityTier}
                  imageUrl={c.imageSmall}
                  value={c.value}
                  condition={c.condition}
                  isReverse={c.isReverse}
                  isNew={c.isNew}
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
              </motion.li>
            ))}
          </motion.ul>

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

function BoosterPack({
  setId,
  setName,
  logoUrl,
  phase,
  reduceMotion,
  onRip,
  compact = false,
}: {
  setId?: string | null;
  setName: string;
  logoUrl: string | null;
  symbolUrl?: string | null;
  phase: "sealed" | "tearing" | "open";
  reduceMotion: boolean;
  onRip: () => void;
  compact?: boolean;
}) {
  const sealed = phase === "sealed";

  return (
    <motion.button
      type="button"
      onClick={sealed ? onRip : undefined}
      disabled={!sealed}
      whileHover={sealed && !reduceMotion ? { y: -10, rotate: -1, scale: 1.02 } : undefined}
      whileTap={sealed && !reduceMotion ? { scale: 0.97 } : undefined}
      transition={{ type: "spring", stiffness: 320, damping: 22 }}
      className={cn(
        "relative block drop-shadow-[0_26px_44px_rgba(0,0,0,0.7)]",
        compact ? "w-36" : "w-52 sm:w-64",
        sealed
          ? "cursor-pointer focus-visible:outline-2 focus-visible:outline-brass"
          : "cursor-default",
      )}
      aria-label={sealed ? `Rip open your ${setName} pack` : `${setName} pack, torn open`}
    >
      <PackWrapper
        setId={setId}
        setName={setName}
        logoUrl={logoUrl}
        phase={phase}
        reduceMotion={reduceMotion}
      />
      {/* The surrounding view owns the instructional copy; a caption here as
          well printed "Ripping…" twice, once from each. */}
    </motion.button>
  );
}
