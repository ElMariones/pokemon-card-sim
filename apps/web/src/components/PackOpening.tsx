"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { rarityDisplay } from "@/lib/rarity-display";
import { CardTile } from "./CardTile";
import { RaritySymbol } from "./RaritySymbol";
import SlidingCards from "./lightswind/sliding-cards";
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
  logoUrl?: string | null;
  symbolUrl?: string | null;
  cost: Cents;
  totalValue: Cents;
  balanceAfter: Cents;
  seedHash: string;
  confidence: Confidence;
  cards: OpenedCardView[];
}

const DWELL_MS: Record<(typeof REVEAL_PROFILE)[RarityTier], number> = {
  quick: 850,
  standard: 1300,
  shine: 1900,
  spectacle: 2800,
};

const EXIT_S = 0.16;
const ENTER_S = { quick: 0.3, standard: 0.34, shine: 0.45, spectacle: 0.7 } as const;

type Phase = "sealed" | "tearing" | "revealing" | "summary";

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

  const advance = useCallback(() => {
    clearTimer();
    setIndex((i) => Math.min(i + 1, cards.length));
  }, [cards.length]);

  const startTear = useCallback(() => {
    if (phase !== "sealed") return;
    if (reduceMotion) {
      setPhase("revealing");
      setIndex(0);
      return;
    }
    setPhase("tearing");
    // flap tears, then cards begin to slide out
    setTimeout(() => {
      setPhase("revealing");
      setIndex(0);
    }, 620);
  }, [phase, reduceMotion]);

  useEffect(() => {
    if (index >= cards.length && phase === "revealing") setPhase("summary");
  }, [index, cards.length, phase]);

  // Sliding Cards is user-driven (swipe/click); auto dwell is disabled to keep
  // the 3D stack and the progress dots in sync. User can still press Space/Next
  // or swipe; Skip jumps to summary. If you want timed auto-reveal, re-enable:
  // const dwell = reduceMotion ? 260 : DWELL_MS[REVEAL_PROFILE[card.rarityTier]];
  // timer.current = setTimeout(advance, dwell);
  useEffect(() => {
    if (phase !== "revealing" || index < 0 || index >= cards.length) return;
    // keep timer cleared — manual swipe/click drives advance
    return clearTimer;
  }, [phase, index, cards]);

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
        else if (phase === "revealing") advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, advance, skip, startTear]);

  const profit = opening.totalValue - opening.cost;

  const slidingData = useMemo(
    () =>
      cards.map((c) => ({
        id: c.inventoryId,
        imageUrl: c.imageLarge ?? c.imageSmall,
        name: c.name,
        number: c.number,
        isHit: c.isHit,
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

      {phase === "sealed" && (
        <motion.div
          key="sealed"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.04 }}
          transition={{ duration: reduceMotion ? 0 : 0.35 }}
          className="flex flex-col items-center gap-6"
        >
          <BoosterPack
            setName={opening.setName}
            logoUrl={opening.logoUrl ?? null}
            symbolUrl={opening.symbolUrl ?? null}
            reduceMotion={!!reduceMotion}
            phase="sealed"
            onRip={startTear}
          />
          <p className="text-manila-3 text-xs">
            Press <kbd className="t-mono">Space</kbd> or click pack to rip
          </p>
        </motion.div>
      )}

      {phase === "tearing" && (
        <motion.div
          key="tearing"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="flex flex-col items-center gap-6"
        >
          <BoosterPack
            setName={opening.setName}
            logoUrl={opening.logoUrl ?? null}
            symbolUrl={opening.symbolUrl ?? null}
            reduceMotion={!!reduceMotion}
            phase="tearing"
            onRip={() => {}}
          />
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-brass text-xs tracking-wide uppercase"
          >
            Ripping…
          </motion.p>
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
            <div className="relative aspect-[2.5/3.5] w-40 opacity-30">
              <BoosterPack
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
              key={opening.openingId}
              cards={slidingData}
              className="w-[300px] h-[420px] sm:w-[340px] sm:h-[480px]"
              cardSize="w-full h-full"
              onCardClick={() => {
                // swipe away top card counts as seeing it
                const next = Math.min(index + 1, cards.length);
                setIndex(next);
                if (next >= cards.length) setPhase("summary");
              }}
            />
            {/* current card meta overlay */}
            {current && (
              <motion.div
                key={current.inventoryId + "-meta"}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="pointer-events-none absolute -bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink/80 px-3 py-1.5 ring-1 ring-seam backdrop-blur"
              >
                <RaritySymbol tier={current.rarityTier} className="h-3 w-3" />
                <span className="text-xs font-medium text-white">{current.name}</span>
                <span className="text-manila-3 text-[11px]">#{current.number}</span>
                <span className="t-num text-brass ml-1 text-xs tabular-nums">{money(current.value)}</span>
                {current.isHit && <span className="bg-brass text-ink ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase">Hit</span>}
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
            <span className="opacity-70">Tap / swipe top card to slide • Space to advance</span>
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={advance}
              className="ring-seam text-manila hover:ring-brass rounded-pane px-4 py-2 text-xs ring-1 transition"
            >
              Next
            </button>
            <button
              type="button"
              onClick={() => setIndex(cards.length)}
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
  setName,
  logoUrl,
  symbolUrl,
  phase,
  reduceMotion,
  onRip,
  compact = false,
}: {
  setName: string;
  logoUrl: string | null;
  symbolUrl: string | null;
  phase: "sealed" | "tearing" | "open";
  reduceMotion: boolean;
  onRip: () => void;
  compact?: boolean;
}) {
  return (
    <motion.button
      type="button"
      onClick={onRip}
      disabled={phase !== "sealed"}
      whileHover={phase === "sealed" && !reduceMotion ? { y: -6, rotate: -0.6 } : undefined}
      whileTap={phase === "sealed" && !reduceMotion ? { scale: 0.98 } : undefined}
      transition={{ type: "spring", stiffness: 420, damping: 22 }}
      className={cn(
        "group relative overflow-hidden rounded-[14px] ring-1 ring-seam focus-visible:outline-2 focus-visible:outline-brass",
        compact ? "aspect-[2.5/3.5] w-44" : "aspect-[2.5/3.5] w-56 sm:w-64",
        phase !== "sealed" && "cursor-default",
      )}
      aria-label={phase === "sealed" ? `Rip open your ${setName} pack` : `${setName} pack, torn open`}
    >
      {/* foil body */}
      <div className="wrapper-mylar absolute inset-0" />

      {/* subtle vertical mylar streaks */}
      <div
        className="pointer-events-none absolute inset-0 opacity-40 mix-blend-overlay"
        style={{
          background:
            "repeating-linear-gradient(100deg, transparent 0 8px, rgba(255,255,255,0.04) 8px 9px, transparent 9px 18px)",
        }}
      />

      {/* pack artwork — logo centered, symbol watermark */}
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          className={cn(
            "absolute left-1/2 top-[42%] w-[78%] -translate-x-1/2 -translate-y-1/2 object-contain drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]",
            compact ? "w-[70%]" : "w-[78%]",
          )}
          draggable={false}
        />
      ) : (
        <span className="t-display absolute left-1/2 top-[42%] w-[85%] -translate-x-1/2 -translate-y-1/2 text-center text-[15px] leading-tight tracking-tight text-white drop-shadow-[0_1px_8px_rgba(0,0,0,0.8)]">
          {setName}
        </span>
      )}

      {symbolUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={symbolUrl}
          alt=""
          className="pointer-events-none absolute bottom-[28%] left-1/2 h-6 w-6 -translate-x-1/2 object-contain opacity-70 mix-blend-overlay"
          draggable={false}
        />
      )}

      {/* bottom bar with set name */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-3 pb-3 pt-8">
        <p className="t-display line-clamp-1 text-center text-[11px] tracking-[0.12em] text-white/90">
          {setName}
        </p>
        {!compact && (
          <p className="text-manila-2 mt-0.5 text-center text-[9px] tracking-[0.18em] uppercase opacity-80">
            {phase === "sealed" ? "Tap to rip" : phase === "tearing" ? "Ripping…" : "Opened"}
          </p>
        )}
      </div>

      {/* crimp — the serrated seal */}
      <motion.div
        className="absolute inset-x-0 top-0 h-[13%] overflow-hidden bg-[#0a0e1a]"
        style={{
          clipPath:
            "polygon(0 0,100% 0,100% 58%,97% 42%,93% 62%,88% 38%,83% 60%,78% 34%,73% 58%,68% 30%,63% 55%,58% 28%,52% 52%,47% 26%,42% 50%,37% 22%,32% 48%,27% 20%,22% 45%,17% 18%,12% 42%,7% 16%,3% 36%,0 30%)",
        }}
        animate={
          reduceMotion
            ? {}
            : phase === "tearing"
              ? { y: -48, rotate: -14, x: 8, opacity: 0 }
              : phase === "open"
                ? { y: -48, opacity: 0 }
                : { y: 0, rotate: 0, opacity: 1 }
        }
        transition={
          phase === "tearing"
            ? { type: "spring", stiffness: 520, damping: 18, mass: 0.7 }
            : { duration: 0.2 }
        }
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              "repeating-linear-gradient(90deg, rgba(0,0,0,0.55) 0 3px, rgba(255,255,255,0.14) 3px 6px)",
          }}
        />
        {/* little tear pull tab */}
        {phase === "sealed" && (
          <motion.div
            animate={{ x: [0, 2, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            className="absolute right-3 top-1/2 h-1.5 w-8 -translate-y-1/2 rounded-full bg-brass/70"
          />
        )}
      </motion.div>

      {/* slit highlight when torn */}
      {phase !== "sealed" && (
        <motion.div
          initial={{ scaleX: 0, opacity: 0 }}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{ delay: 0.18, duration: 0.22 }}
          className="absolute left-3 right-3 top-[13%] h-[3px] origin-center rounded-full bg-ink blur-[0.5px]"
        />
      )}

      {/* spring layout for cards peeking — handled by parent, but keep slit shadow */}
      <div className="pointer-events-none absolute inset-0 rounded-[14px] ring-1 ring-white/10" />
    </motion.button>
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
      initial={reduceMotion ? { opacity: 0, y: 12 } : { opacity: 0, y: 28, rotateY: -18, scale: 0.92 }}
      animate={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 1, y: 0, rotateY: 0, scale: big ? 1.04 : 1 }}
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
