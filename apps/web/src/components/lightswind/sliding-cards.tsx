"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

export type CardContent = {
  id: string | number;
  imageUrl?: string | null;
  name?: string;
  isHit?: boolean;
};

type SlidingCardsProps = {
  cards: CardContent[];
  /** Index of the card currently on top of the stack. */
  activeIndex: number;
  /** True when the active card has been turned over. */
  revealed: boolean;
  className?: string;
  onReveal: () => void;
  onAdvance: () => void;
  /**
   * Fires when a card's front actually becomes visible. The card id is
   * included so the listener can ignore a late report from a card that has
   * already left — AnimatePresence delays unmount, so a departing card's
   * cleanup can otherwise land after the next card has been turned over.
   */
  onFaceChange?: (faceUp: boolean, cardId: string | number) => void;
};

/**
 * A deck of face-down cards, turned over one at a time.
 *
 * Two layers, deliberately separate:
 *
 *   - The DECK is every card behind the current one. Always face-down, never
 *     interactive, purely scenery.
 *   - The ACTIVE card sits above it. It is the only card that flips, drags or
 *     leaves.
 *
 * Collapsing those into one stack is what broke the earlier version: a
 * dismissed card kept the z-index it held while on top, tied with the card
 * replacing it, and covered it on the way out.
 */

/** Flip duration. The face swap is keyed to exactly half of it. */
const FLIP_SECONDS = 0.52;

const DECK_POSES = [
  { x: -14, y: 9, rotate: -3 },
  { x: 17, y: 17, rotate: 3.4 },
  { x: -9, y: 25, rotate: -1.8 },
] as const;

const DECK_DEPTH = DECK_POSES.length;

const Z_DECK = 10;
const Z_ACTIVE = 100;
/** Above the incoming card, so a dismissed card passes in front of it. */
const Z_LEAVING = 200;

const CARD_SURFACE =
  "absolute inset-0 block rounded-[16px] bg-[#071321] shadow-[0_20px_42px_rgba(0,0,0,0.48)]";

function CardBack({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span className={cn(CARD_SURFACE, className)} style={style}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/card-back.jpg"
        alt=""
        className="h-full w-full rounded-[16px] object-cover"
        // One shared image across the whole deck, so it is worth fetching
        // eagerly and decoding off the main thread.
        loading="eager"
        decoding="async"
        draggable={false}
      />
      <span className="pointer-events-none absolute inset-0 rounded-[16px] ring-1 ring-white/20" />
    </span>
  );
}

/**
 * The card that turns over.
 *
 * Which face is painted is React state, not a CSS or animation concern.
 * `backface-visibility` could not be relied on: at rest the rotator resolves to
 * no transform, the element stops establishing a 3D rendering context, its
 * children flatten, and a flattened element ignores backface-visibility — so a
 * fully turned card kept showing its back. Driving the swap from a timer that
 * fires at the halfway point is deterministic, and invisible to the player
 * because the card is edge-on at exactly that moment.
 *
 * The component is keyed by card id by its parent, so this state resets for
 * every card without anyone having to remember to clear it.
 */
function FlipCard({
  card,
  revealed,
  reduceMotion,
  onFaceChange,
}: {
  card: CardContent;
  revealed: boolean;
  reduceMotion: boolean;
  onFaceChange?: (faceUp: boolean, cardId: string | number) => void;
}) {
  const [showFront, setShowFront] = useState(false);

  // With no animation to observe, sync directly.
  useEffect(() => {
    if (reduceMotion) setShowFront(revealed);
  }, [revealed, reduceMotion]);

  // The name and price are published from the same signal that paints the
  // artwork. Deriving them separately let the label appear over a card that
  // was still face-down, which gives the pull away before it is turned.
  useEffect(() => {
    onFaceChange?.(showFront, card.id);
  }, [showFront, onFaceChange, card.id]);

  return (
    <motion.span
      className="relative block h-full w-full rounded-[16px] [transform-style:preserve-3d]"
      initial={{ rotateY: 180 }}
      animate={{ rotateY: revealed ? 0 : 180 }}
      // A tween, not a spring: a flip has a definite end, and a spring that
      // settles over a second reads as the card being stuck.
      transition={
        reduceMotion ? { duration: 0 } : { duration: FLIP_SECONDS, ease: [0.34, 0.02, 0.2, 1] }
      }
      // The swap is driven by the rotation itself rather than a timer set to
      // half the duration. A timer drifts from the animation — it fired on
      // schedule while the rotation was still near 180, so the front appeared
      // mirrored. Reading the angle is exact and self-correcting.
      onUpdate={(latest) => {
        const deg = Math.abs(Number(latest.rotateY) % 360);
        const front = revealed && (deg < 90 || deg > 270);
        setShowFront((prev) => (prev === front ? prev : front));
      }}
    >
      <span className={CARD_SURFACE} style={{ opacity: showFront ? 1 : 0 }}>
        {card.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.imageUrl}
            alt=""
            className="h-full w-full rounded-[16px] object-cover"
            decoding="async"
            draggable={false}
          />
        ) : (
          <span className="text-manila-3 grid h-full place-content-center">No card image</span>
        )}
        {card.isHit && (
          <span className="ring-brass/80 pointer-events-none absolute inset-0 rounded-[16px] shadow-[inset_0_0_32px_rgba(211,160,60,0.45)] ring-2" />
        )}
      </span>

      {/* The back stays mounted and is simply hidden once the swap happens,
          which avoids a reflow in the middle of the flip. */}
      <CardBack
        className="[transform:rotateY(180deg)]"
        style={{ opacity: showFront ? 0 : 1 }}
      />
    </motion.span>
  );
}

export default function SlidingCards({
  cards,
  activeIndex,
  revealed,
  className,
  onReveal,
  onAdvance,
  onFaceChange,
}: SlidingCardsProps) {
  const reduceMotion = useReducedMotion();
  const active = cards[activeIndex];
  const behind = cards.slice(activeIndex + 1, activeIndex + 1 + DECK_DEPTH);

  return (
    <section
      className={cn("relative h-[22rem] w-64 select-none sm:h-[28rem] sm:w-80", className)}
      aria-label="Card reveal stack"
    >
      {behind.map((card, i) => {
        const pose = DECK_POSES[Math.min(i, DECK_POSES.length - 1)]!;
        return (
          <motion.div
            key={card.id}
            aria-hidden
            initial={false}
            animate={{
              x: pose.x,
              y: pose.y,
              rotate: pose.rotate,
              scale: 1 - (i + 1) * 0.02,
              opacity: 1 - (i + 1) * 0.08,
            }}
            transition={{ type: "spring", stiffness: 340, damping: 30, mass: 0.7 }}
            style={{ zIndex: Z_DECK - i }}
            className="pointer-events-none absolute inset-0"
          >
            <CardBack />
          </motion.div>
        );
      })}

      <AnimatePresence initial={false}>
        {active && (
          <motion.button
            key={active.id}
            type="button"
            drag={!reduceMotion ? "x" : false}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.7}
            dragSnapToOrigin
            onDragStart={() => { if (!revealed) onReveal(); }}
            onDragEnd={(_, info) => {
              if (revealed && (Math.abs(info.offset.x) > 90 || Math.abs(info.velocity.x) > 700)) {
                onAdvance();
              }
            }}
            onClick={() => (revealed ? onAdvance() : onReveal())}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 40, scale: 0.94 }}
            animate={{ opacity: 1, x: 0, y: 0, rotate: 0, scale: 1 }}
            // A departing card passes in front of the incoming one, so it must
            // stop accepting pointer events on the way out — otherwise it sits
            // over the new card for the length of its flight and swallows the
            // click meant to turn that card over.
            exit={
              reduceMotion
                ? { opacity: 0, pointerEvents: "none", transition: { duration: 0.12 } }
                : {
                    x: 430,
                    y: -70,
                    rotate: 24,
                    opacity: 0,
                    zIndex: Z_LEAVING,
                    pointerEvents: "none",
                    transition: { duration: 0.34, ease: [0.4, 0, 0.85, 0.6] },
                  }
            }
            transition={{ type: "spring", stiffness: 360, damping: 30, mass: 0.7 }}
            whileHover={!reduceMotion ? { y: -8 } : undefined}
            whileTap={!reduceMotion ? { scale: 0.985 } : undefined}
            className="absolute inset-0 block rounded-[16px] text-left will-change-transform [perspective:1400px] focus-visible:outline-2 focus-visible:outline-brass"
            style={{ zIndex: Z_ACTIVE }}
            aria-label={
              revealed
                ? `${active.name ?? "Card"} revealed. Activate to move it aside.`
                : "Face-down card. Activate to turn it over."
            }
          >
            <FlipCard
              key={active.id}
              card={active}
              revealed={revealed}
              reduceMotion={!!reduceMotion}
              onFaceChange={onFaceChange}
            />
          </motion.button>
        )}
      </AnimatePresence>
    </section>
  );
}
