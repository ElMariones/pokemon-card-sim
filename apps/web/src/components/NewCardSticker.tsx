"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";

type NewCardStickerProps = {
  className?: string;
  /** The reveal card can carry a larger seal than the compact result grid. */
  size?: "reveal" | "tile";
};

/**
 * A deliberately tactile, nine-point album-completion seal. It is kept as a
 * shared component so a card means the same thing while it is being revealed
 * and once it joins the opening summary.
 */
export function NewCardSticker({ className, size = "tile" }: NewCardStickerProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.span
      className={cn(
        "new-card-sticker pointer-events-none absolute z-20 grid place-items-center",
        size === "reveal" ? "-right-5 -top-5 h-24 w-24 sm:h-28 sm:w-28" : "-right-3 -top-3 h-14 w-14 sm:h-[4.5rem] sm:w-[4.5rem]",
        className,
      )}
      initial={reduceMotion ? false : { opacity: 0, scale: 0.55, rotate: -18, y: -8 }}
      animate={
        reduceMotion
          ? undefined
          : {
              opacity: 1,
              scale: [0.55, 1.13, 0.97, 1],
              rotate: [-18, 5, -2, 0],
              y: [-8, 0, -1, 0],
            }
      }
      transition={{ duration: 0.55, times: [0, 0.54, 0.8, 1], ease: [0.22, 1, 0.36, 1] }}
      aria-label="New to your album"
    >
      <span className="new-card-sticker__glow absolute inset-[11%] rounded-full" aria-hidden />
      <motion.svg
        viewBox="0 0 100 100"
        className="new-card-sticker__star relative h-full w-full overflow-visible"
        aria-hidden
        animate={reduceMotion ? undefined : { rotate: [-2, 2, -2], y: [0, -1, 0] }}
        transition={{ duration: 2.9, ease: "easeInOut", repeat: Infinity }}
      >
        <polygon
          points="50,2 58.9,25.6 79.5,15.5 75.9,39.5 97,50 75.9,60.5 79.5,84.5 58.9,74.4 50,98 41.1,74.4 20.5,84.5 24.1,60.5 3,50 24.1,39.5 20.5,15.5 41.1,25.6"
          className="new-card-sticker__edge"
        />
        <polygon
          points="50,10 57.1,29 73.6,20.9 70.7,42 87,50 70.7,58 73.6,79.1 57.1,71 50,90 42.9,71 26.4,79.1 29.3,58 13,50 29.3,42 26.4,20.9 42.9,29"
          className="new-card-sticker__face"
        />
        <path d="M30 38C38 30 63 28 73 38" className="new-card-sticker__shine" />
      </motion.svg>
      <span className="new-card-sticker__word absolute inset-0 grid place-items-center pt-0.5">NEW!</span>
    </motion.span>
  );
}
