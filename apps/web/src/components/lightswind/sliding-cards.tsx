"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import { cn } from "@/lib/cn";

export type CardContent = {
  id: string | number;
  imageUrl?: string | null;
  name?: string;
  isHit?: boolean;
};

type SlidingCardsProps = {
  cards: CardContent[];
  activeIndex: number;
  revealedIndex: number;
  className?: string;
  onReveal: () => void;
  onAdvance: () => void;
};

const STACK_OFFSETS = [
  { x: 0, y: 0, rotate: 0 },
  { x: -15, y: 10, rotate: -3.1 },
  { x: 18, y: 18, rotate: 3.6 },
  { x: -9, y: 27, rotate: -1.8 },
  { x: 13, y: 34, rotate: 2.4 },
] as const;

/** A state-driven, card-back-first adaptation of Lightswind's card stack. */
export default function SlidingCards({ cards, activeIndex, revealedIndex, className, onReveal, onAdvance }: SlidingCardsProps) {
  const reduceMotion = useReducedMotion();
  const [revealedCardId, setRevealedCardId] = useState<string | number | null>(null);
  const deck = cards.slice(activeIndex);

  return (
    <section className={cn("relative h-[22rem] w-64 select-none sm:h-[28rem] sm:w-80", className)} aria-label="Card reveal stack">
      {deck.map((card, stackIndex) => {
        const isTop = stackIndex === 0;
        const isRevealed = revealedCardId === card.id || revealedIndex === activeIndex;
        const pose = STACK_OFFSETS[Math.min(stackIndex, STACK_OFFSETS.length - 1)];

        return (
          <motion.button
            key={card.id}
            type="button"
            layout
            drag={isTop && !reduceMotion ? "x" : false}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.82}
            dragSnapToOrigin
            onDragStart={() => {
              if (!isRevealed) {
                setRevealedCardId(card.id);
                onReveal();
              }
            }}
            onDragEnd={(_, info) => {
              if (isRevealed && (Math.abs(info.offset.x) > 96 || Math.abs(info.velocity.x) > 760)) {
                onAdvance();
              }
            }}
            onClick={() => {
              if (isRevealed) onAdvance();
              else {
                setRevealedCardId(card.id);
                onReveal();
              }
            }}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 150, scale: 0.92, rotate: pose.rotate }}
            animate={{
              opacity: 1 - Math.min(stackIndex, 4) * 0.08,
              x: pose.x,
              y: pose.y,
              rotate: pose.rotate,
              scale: 1 - Math.min(stackIndex, 4) * 0.018,
              zIndex: 100 - stackIndex,
            }}
            transition={{ type: "spring", stiffness: 340, damping: 27, mass: 0.8 }}
            whileHover={isTop && !reduceMotion ? { y: pose.y - 6 } : undefined}
            className={cn(
              "absolute inset-0 block rounded-[16px] text-left [perspective:1200px]",
              isTop ? "cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-brass" : "pointer-events-none",
            )}
            aria-label={isTop ? (isRevealed ? `Move ${card.name ?? "card"} aside` : "Turn over the next card") : undefined}
          >
            <motion.span
              className="relative block h-full w-full rounded-[16px] [transform-style:preserve-3d]"
              animate={{ rotateY: isRevealed ? 0 : 180 }}
              transition={{ type: "spring", stiffness: 300, damping: 24 }}
            >
              <span className="absolute inset-0 block overflow-hidden rounded-[16px] bg-[#071321] shadow-[0_20px_42px_rgba(0,0,0,0.48)] [backface-visibility:hidden]">
                {card.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={card.imageUrl} alt={card.name ?? "Pokémon card"} className="h-full w-full object-cover" draggable={false} />
                ) : (
                  <span className="grid h-full place-content-center text-manila-3">No card image</span>
                )}
                {card.isHit && <span className="pointer-events-none absolute inset-0 rounded-[16px] ring-2 ring-brass/80 shadow-[inset_0_0_32px_rgba(211,160,60,0.45)]" />}
              </span>
              <span className="absolute inset-0 block overflow-hidden rounded-[16px] bg-[#071321] shadow-[0_20px_42px_rgba(0,0,0,0.48)] [backface-visibility:hidden] [transform:rotateY(180deg)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/card-back.jpg" alt="Face-down Pokémon card" className="h-full w-full object-cover" draggable={false} />
                <span className="pointer-events-none absolute inset-0 rounded-[16px] ring-1 ring-white/20" />
              </span>
            </motion.span>
          </motion.button>
        );
      })}
    </section>
  );
}
