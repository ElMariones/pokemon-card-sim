"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";

type NewCardStickerProps = {
  className?: string;
  /** The reveal card can carry a larger seal than the compact result grid. */
  size?: "reveal" | "tile";
};

// Both layers use the same nine equally spaced tips. Keeping these generated
// from one centre/angle system prevents a visually "almost" symmetrical seal.
const OUTER_NINE_POINT_STAR =
  "50,3 59.58,23.69 80.21,14.04 74.25,36 96.29,41.84 77.57,54.86 90.7,73.5 68,71.45 66.07,94.16 50,78 33.93,94.16 32,71.45 9.3,73.5 22.43,54.86 3.71,41.84 25.75,36 19.79,14.04 40.42,23.69";

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
        size === "reveal"
          ? "new-card-sticker--reveal -right-5 -top-5 h-24 w-24 sm:h-28 sm:w-28"
          : "new-card-sticker--tile -right-3 -top-3 h-14 w-14 sm:h-[4.5rem] sm:w-[4.5rem]",
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
          points={OUTER_NINE_POINT_STAR}
          className="new-card-sticker__edge"
        />
        <g transform="translate(50 50) scale(0.76) translate(-50 -50)">
          <polygon points={OUTER_NINE_POINT_STAR} className="new-card-sticker__face" />
        </g>
      </motion.svg>
      <span className="new-card-sticker__word absolute inset-0 grid place-items-center">NEW!</span>
    </motion.span>
  );
}
