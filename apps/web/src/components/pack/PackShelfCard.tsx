"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { memo, useState } from "react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { PackWrapper } from "./PackWrapper";
import { type Cents, type Confidence } from "@pcs/shared";

/**
 * How a pack's price was arrived at, in the shop's words.
 *
 * The shared CONFIDENCE_LABEL map is written for pull rates ("Estimated pull
 * rate"), which is the wrong sentence for a price.
 */
const PRICE_BASIS: Record<Confidence, string> = {
  official: "Official price",
  manufacturer_published: "Published price",
  documented_community_data: "Sealed market",
  estimated: "Estimated",
  unknown: "Unknown",
};

export interface ShelfSet {
  id: string;
  name: string;
  era: string;
  releaseDate: string;
  cardCount: number;
  pricedCount: number;
  avgPrice: number;
  packPrice: number;
  packSize: number;
  packPriceConfidence?: string | null;
  ownedCards?: number;
  logoUrl: string | null;
  symbolUrl: string | null;
}

/** A shelf listing: the pack itself, what you have of the set, and the buttons. */
function PackShelfCardImpl({
  set,
  cash,
  busy,
  reduceMotion,
  onBuy,
}: {
  set: ShelfSet;
  cash: number | null;
  busy: boolean;
  reduceMotion: boolean;
  onBuy: (setId: string, count: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  /** Bumped on every purchase so the wrapper can flash without new state. */
  const [pulse, setPulse] = useState(0);

  const owned = set.ownedCards ?? 0;
  const pct = set.cardCount > 0 ? Math.round((owned / set.cardCount) * 100) : 0;
  const canBuy1 = cash === null || cash >= set.packPrice;
  const canBuy10 = cash === null || cash >= set.packPrice * 10;

  const buy = (count: number) => {
    setPulse((p) => p + 1);
    onBuy(set.id, count);
  };

  return (
    <li className="pane ring-seam hover:ring-seam-bright relative overflow-hidden p-5 transition">
      <div className="flex gap-5">
        <div className="relative w-24 shrink-0 sm:w-28">
          <motion.div
            whileHover={reduceMotion ? undefined : { y: -6, rotate: -1.2, scale: 1.03 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="drop-shadow-[0_14px_26px_rgba(0,0,0,0.6)]"
          >
            <PackWrapper
              setId={set.id}
              setName={set.name}
              logoUrl={set.logoUrl}
              phase="sealed"
              reduceMotion={reduceMotion}
            />
          </motion.div>

          {/* The wrapper flashes when a pack leaves the shelf. */}
          <AnimatePresence>
            {pulse > 0 && (
              <motion.span
                key={pulse}
                className="bg-brass-hot pointer-events-none absolute inset-0 rounded-[4px] mix-blend-screen"
                initial={{ opacity: 0.55, scale: 1 }}
                animate={{ opacity: 0, scale: 1.12 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                aria-hidden
              />
            )}
          </AnimatePresence>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-w-0">
            <h3 className="t-display truncate text-base leading-tight">{set.name}</h3>
            <p className="text-manila-3 mt-0.5 text-[11px]">
              {set.releaseDate.slice(0, 4)} · {set.cardCount} cards
              {set.packSize > 0 ? ` · ${set.packSize} per pack` : ""}
            </p>
          </div>

          {/* Completion, drawn here rather than only on the set page: it is the
              one number that decides whether another pack of this set is worth
              buying. */}
          <div className="mt-3">
            <div className="text-manila-3 mb-1 flex items-baseline justify-between text-[11px]">
              <span className="t-eyebrow">Collected</span>
              <span className="t-num text-manila-2 tabular-nums">
                {owned}/{set.cardCount} · {pct}%
              </span>
            </div>
            <div className="bg-vitrine-3 ring-seam h-1.5 overflow-hidden rounded-full ring-1">
              <motion.div
                className="bg-brass h-full rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: reduceMotion ? 0 : 0.6, ease: "easeOut" }}
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="t-num text-brass mr-auto text-lg tabular-nums">
              {money(set.packPrice as Cents)}
            </span>

            <BuyButton
              label="Open 1"
              disabled={busy || !canBuy1}
              reduceMotion={reduceMotion}
              onClick={() => buy(1)}
              title={canBuy1 ? undefined : "Not enough cash"}
              ariaLabel={`Open one ${set.name} pack for ${money(set.packPrice as Cents)}`}
            />
            <BuyButton
              label="×10"
              variant="quiet"
              disabled={busy || !canBuy10}
              reduceMotion={reduceMotion}
              onClick={() => buy(10)}
              title={canBuy10 ? undefined : "Not enough cash for ten"}
              ariaLabel={`Open ten ${set.name} packs for ${money((set.packPrice * 10) as Cents)}`}
            />
          </div>

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="text-manila-3 hover:text-brass mt-3 -mb-1 flex items-center gap-1.5 self-start text-[11px] tracking-wide uppercase transition"
          >
            Contents
            <motion.span
              animate={{ rotate: expanded ? 180 : 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.2 }}
              aria-hidden
            >
              ▾
            </motion.span>
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.3, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <dl className="border-seam mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t pt-4 sm:grid-cols-4">
              <Fact label="Still missing" value={`${Math.max(0, set.cardCount - owned)} cards`} />
              <Fact label="Cards priced" value={`${set.pricedCount}/${set.cardCount}`} />
              <Fact label="Average card" value={money(set.avgPrice as Cents)} />
              <Fact
                label="Price from"
                value={PRICE_BASIS[set.packPriceConfidence as Confidence] ?? "Estimated"}
              />
            </dl>
            <Link
              href={`/set/${set.id}`}
              scroll={false}
              className="text-brass hover:text-brass-hot mt-4 inline-block text-xs tracking-wide uppercase transition"
            >
              Open the binder →
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

/**
 * Memoised: a shelf card is a full inline-SVG wrapper, so re-rendering the
 * whole shelf on every keystroke in the search box was the bulk of the typing
 * latency. The props are all stable — `onBuy` is a `useCallback` on the page.
 */
export const PackShelfCard = memo(PackShelfCardImpl);

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="t-eyebrow text-manila-3">{label}</dt>
      <dd className="t-num text-manila mt-0.5 truncate text-sm tabular-nums">{value}</dd>
    </div>
  );
}

function BuyButton({
  label,
  onClick,
  disabled,
  reduceMotion,
  title,
  ariaLabel,
  variant = "primary",
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  reduceMotion: boolean;
  title?: string;
  ariaLabel: string;
  variant?: "primary" | "quiet";
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      whileHover={disabled || reduceMotion ? undefined : { y: -2 }}
      whileTap={disabled || reduceMotion ? undefined : { scale: 0.94, y: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 24 }}
      className={cn(
        "rounded-pane px-4 py-2 text-xs font-semibold tracking-wide transition",
        disabled
          ? "text-manila-3 ring-seam cursor-not-allowed ring-1"
          : variant === "primary"
            ? "bg-brass text-ink hover:bg-brass-hot"
            : "bg-vitrine-3 text-manila ring-seam hover:ring-brass ring-1",
      )}
    >
      {label}
    </motion.button>
  );
}
